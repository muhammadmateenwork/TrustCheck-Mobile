import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions, CameraCapturedPicture } from 'expo-camera';
import { MaterialIcons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { useWorkflow } from '../hooks/WorkflowContext';
import { newPhotoFilePath, mediaDir } from '../services/fileStorage';
import CassetteGuideOverlay, { computeSearchRectFraction, GuideRectFraction } from '../components/CassetteGuideOverlay';
import CassetteAnalyzerBridge, { CassetteAnalyzerHandle } from '../components/CassetteAnalyzerBridge';
import { isConfidentlyDetected, applyReadingTo } from '../models/CassetteReading';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'DrugCassetteScan'>;

const CAMERA_FRAME_ASPECT_RATIO = 3 / 4; // width / height, portrait — mirrors the native constant

const IDLE_STATUS_TEXT = "Align the cassette's result window inside the frame";
const AUTO_SCAN_INITIAL_DELAY_MS = 1200;
// Trimmed from 1500ms now that searchAndAnalyze() only pays for a canvas pixel readback once per
// rotation instead of once per candidate (see that function's own doc) — each attempt is
// meaningfully cheaper than when this delay was first chosen, so the fixed gap between attempts
// can shrink too without outrunning a slower device's actual processing time (isCapturingRef
// still guards against overlap regardless).
const AUTO_SCAN_RETRY_DELAY_MS = 900;
/** How many consecutive attempts have to each independently pass isConfidentlyDetected() before
 *  it's trusted — a real, on-device timing problem forced dropping the earlier version of this
 *  requirement, which also required the exact same line-by-line pattern (including every
 *  substance line) to repeat across attempts: substance lines are legitimately allowed to be
 *  faint/borderline (see isConfidentlyDetected's own doc on why confidence is only required on
 *  control lines, not substances), so two otherwise-genuine confident reads of the SAME real
 *  cassette could still disagree on one borderline substance bit and reset the streak, forcing
 *  extra retries for no real safety benefit — isConfidentlyDetected's own confidence bars are
 *  what actually guards against a stray false positive; requiring that check to independently
 *  pass twice in a row is the real defense against this port's continuous-retry loop (native
 *  never needed this — it only ever risks one single analysis per deliberate manual tap). */
const CONSECUTIVE_CONFIRMATIONS_REQUIRED = 2;
/** How long the "Kit detected!" success flash holds before handing off to DrugTestPicture — just
 *  long enough to register as a distinct moment (like a barcode scanner's beep-and-flash) rather
 *  than the screen instantly cutting away, which read as an abrupt glitch rather than a
 *  deliberate "got it" confirmation. */
const SUCCESS_FLASH_MS = 450;

/** Winning near the smallest/largest SEARCH_SCALES entries (see cassetteAnalyzerHtml.ts — kept in
 *  sync with that list by eye: [0.85, 0.65, 0.5, 0.35]) grounds "move closer"/"move back"
 *  distance guidance in the analyzer's own search result, rather than guessing blind — see
 *  distanceGuidance's own doc for why this is only ever trusted when bestScore clears
 *  NO_SIGNAL_SCORE. */
const FAR_SCALE_THRESHOLD = 0.4;
const CLOSE_SCALE_THRESHOLD = 0.8;
/** Below this, literally no candidate this attempt had both control lines read as present
 *  anywhere — no real signal to base distance guidance on, so distanceGuidance falls back to the
 *  generic "still looking" message instead of guessing a direction from noise. */
const NO_SIGNAL_SCORE = -1;

/** Turns one attempt's raw search result into on-screen guidance — deliberately only speaks when
 *  there's a real signal to ground it in (bestScore > NO_SIGNAL_SCORE, i.e. some candidate really
 *  did read both control lines as present somewhere), never fabricating a direction from a
 *  best-of-nothing candidate that searchAndAnalyze() always returns regardless (see that
 *  function's own doc) — the whole reason this wasn't built as a naive "always show the winning
 *  scale" readout. */
function distanceGuidance(bestScore: number, matchedScale: number | null): string {
  if (bestScore <= NO_SIGNAL_SCORE || matchedScale == null) return 'Scanning for kit…';
  if (matchedScale <= FAR_SCALE_THRESHOLD) return 'Move the kit closer';
  if (matchedScale >= CLOSE_SCALE_THRESHOLD) return "Move the kit back a little — it's too close";
  return 'Kit in view — hold steady';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The camera screen for one of two modes, chosen on DrugTestPictureScreen BEFORE this screen ever
 * opens ("Scan Kit" vs. "Take Picture" — two separate buttons there, not a choice repeated here;
 * see this route's own param doc). This screen just does the one thing already chosen:
 *
 * - mode "scan": starts the auto-detect loop the moment the camera is ready — every ~1s it
 *   silently takes a photo, crops it to a wide area around the guide box (see
 *   CassetteGuideOverlay#computeSearchRectFraction), and searches that area across several
 *   distances/tilts for the cassette (see CassetteAnalyzerBridge and
 *   cassetteAnalyzerHtml.ts#searchAndAnalyze) rather than assuming it exactly fills the guide box.
 *   Once a CONFIDENT reading (see CassetteReading#isConfidentlyDetected: both control lines
 *   present with a real confidence margin, both strips structurally consistent with each other —
 *   see that file's own doc) is found on CONSECUTIVE_CONFIRMATIONS_REQUIRED attempts in a row,
 *   that attempt's raw capture is cropped down to just its own wide search area (see
 *   saveCassetteCrop) and becomes the saved/displayed photo, with the result auto-filled as if
 *   the operator had captured it themselves. Failed attempts are discarded silently and it just
 *   keeps trying until cancelled.
 * - mode "manual": one manual capture (same search-area crop, no analysis at all), triggered by a
 *   single shutter button — the operator enters the result by hand on the next screen. For when
 *   auto-detect is struggling, or the operator would just rather not wait on it.
 *
 * isConfidentlyDetected() plus the two-in-a-row consensus requirement are deliberately stricter
 * than the native app's own single isFullyValid() check — this loop retries continuously while
 * the operator moves the camera around (native only ever analyzes once, on a deliberate manual
 * tap), so a weaker relative-contrast check that's merely "unlikely" to false-positive on
 * non-cassette content (a wall, furniture, anything with a repeating light/dark pattern) becomes
 * "eventually inevitable" given enough attempts. See isConfidentlyDetected's own doc for exactly
 * what it checks, and CONSECUTIVE_CONFIRMATIONS_REQUIRED's own doc for why the consensus
 * requirement no longer also demands an exact substance-level match.
 *
 * NOT VALIDATED ON A REAL DEVICE — the pixel-analysis algorithm (see cassetteAnalyzerHtml.ts) is
 * a faithful port of the native CassetteAnalyzer, but this whole camera+analysis pipeline (and
 * especially the repeated-capture scanning loop, which has no native equivalent to compare
 * against) has no way to be tested from here. Treat detection accuracy and the scan cadence as
 * unverified until tried on a real phone.
 */
export default function DrugCassetteScanScreen({ navigation, route }: Props) {
  const mode = route.params.mode;
  const { record } = useWorkflow();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [statusText, setStatusText] = useState(
    mode === 'manual' ? "Center the cassette's result window, then tap to capture" : IDLE_STATUS_TEXT
  );
  const [detected, setDetected] = useState(false);
  const [captureFlash, setCaptureFlash] = useState(false);

  const cameraRef = useRef<CameraView>(null);
  const analyzerRef = useRef<CassetteAnalyzerHandle>(null);
  const isCapturingRef = useRef(false);
  const autoScanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoScanStopped = useRef(true);
  const confirmStreak = useRef(0);

  useEffect(() => {
    if (permission && !permission.granted) void requestPermission();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission]);

  useEffect(() => {
    // Belt-and-suspenders alongside the explicit stopAutoScan() calls below — guarantees the
    // background loop can never fire a takePictureAsync() against an unmounted camera view.
    return () => stopAutoScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Letterboxed 4:3 frame within the screen — CameraView is sized to exactly this rect, which is
  // what lets CassetteGuideOverlay's fraction math apply directly with no separate "camera frame
  // within a bigger view" step (see that component's own doc).
  let frameWidth: number, frameHeight: number;
  if (screenWidth / screenHeight > CAMERA_FRAME_ASPECT_RATIO) {
    frameHeight = screenHeight;
    frameWidth = frameHeight * CAMERA_FRAME_ASPECT_RATIO;
  } else {
    frameWidth = screenWidth;
    frameHeight = frameWidth / CAMERA_FRAME_ASPECT_RATIO;
  }

  /** Overwrites `outputPath` with just the wide search area (see computeSearchRectFraction) cut
   *  out of the raw capture — trims away most of the surrounding scene (background, hand, table)
   *  the camera sensor actually saw beyond that, without risking cutting off part of the cassette
   *  itself the way the analyzer's own internal winning-candidate crop could (that crop is
   *  purpose-built to zoom in tight on just the two reading strips for pixel analysis, and can
   *  end up scaled or slightly rotated relative to the original capture — fine for reading lines,
   *  not what should become the permanent saved photo). The search area is always axis-aligned
   *  and a fixed size relative to the frame, generous enough that a real capture whose framing was
   *  good enough to actually get detected essentially always has the whole cassette within it. */
  const saveCassetteCrop = async (photo: CameraCapturedPicture, searchFraction: GuideRectFraction, outputPath: string) => {
    const originX = Math.round(searchFraction.left * photo.width);
    const originY = Math.round(searchFraction.top * photo.height);
    const width = Math.round((searchFraction.right - searchFraction.left) * photo.width);
    const height = Math.round((searchFraction.bottom - searchFraction.top) * photo.height);
    const result = await ImageManipulator.manipulateAsync(
      photo.uri,
      [{ crop: { originX, originY, width, height } }],
      { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG }
    );
    await FileSystem.copyAsync({ from: result.uri, to: outputPath });
  };

  const deliverResult = (photoPath: string, readValid: boolean, detectionAttempted: boolean) => {
    navigation.navigate({
      name: 'DrugTestPicture',
      params: { photoPath, readValid, detectionAttempted, scanAt: Date.now() },
      merge: true,
    });
  };

  const stopAutoScan = () => {
    autoScanStopped.current = true;
    setScanning(false);
    setStatusText(IDLE_STATUS_TEXT);
    if (autoScanTimer.current) {
      clearTimeout(autoScanTimer.current);
      autoScanTimer.current = null;
    }
  };

  /** "Scan Kit" — starts the auto-detect loop. Scanning never starts on its own (see this
   *  screen's own doc for why); the operator has to deliberately opt into it. */
  const onScanKit = () => {
    if (scanning || isCapturingRef.current || !cameraRef.current || !record.id) return;
    confirmStreak.current = 0;
    autoScanStopped.current = false;
    setDetected(false);
    setScanning(true);
    setStatusText('Scanning for kit…');
    autoScanTimer.current = setTimeout(() => {
      void runCaptureAttempt();
    }, AUTO_SCAN_INITIAL_DELAY_MS);
  };

  const scheduleNextAutoScan = () => {
    if (autoScanStopped.current) return;
    autoScanTimer.current = setTimeout(() => {
      void runCaptureAttempt();
    }, AUTO_SCAN_RETRY_DELAY_MS);
  };

  /** One background capture-and-analyze attempt — discards the photo and quietly tries again on
   *  anything less than a confidently-detected reading that also matches the previous attempt's
   *  pattern (see CONSECUTIVE_CONFIRMATIONS_REQUIRED), so the operator never sees a failed
   *  attempt at all. */
  const runCaptureAttempt = async () => {
    if (isCapturingRef.current || !cameraRef.current || !record.id) return;
    isCapturingRef.current = true;

    try {
      // shutterSound: false — the background auto-scan loop fires this every ~1s; a shutter
      // click on every silent retry would be constant and obviously wrong to hear.
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9, shutterSound: false });
      if (!photo) throw new Error('No photo returned');

      const outputPath = await newPhotoFilePath(record.id, 'drug_test_photo');
      await FileSystem.copyAsync({ from: photo.uri, to: outputPath });

      const searchFraction = computeSearchRectFraction();
      const { reading, matchedScale, bestScore } = await (analyzerRef.current?.cropAndAnalyze(outputPath, searchFraction) ??
        Promise.resolve({ reading: null, matchedScale: null, bestScore: -1 }));

      const valid = !!reading && isConfidentlyDetected(reading);
      if (valid && reading) {
        confirmStreak.current += 1;

        if (confirmStreak.current >= CONSECUTIVE_CONFIRMATIONS_REQUIRED) {
          applyReadingTo(reading, record.drugResult);
          record.drugResult.autoDetected = true;
          stopAutoScan();
          // A distinct "got it" moment (haptic + green flash) instead of the screen instantly
          // cutting away — reinforces that this is a real scanner reacting to the cassette, not a
          // photo silently being taken. See SUCCESS_FLASH_MS's own doc.
          setDetected(true);
          setStatusText('Kit detected!');
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          await sleep(SUCCESS_FLASH_MS);
          await saveCassetteCrop(photo, searchFraction, outputPath);
          deliverResult(outputPath, true, true);
          return;
        }

        // A confident read, but not yet enough in a row (see CONSECUTIVE_CONFIRMATIONS_REQUIRED's
        // own doc) — the confirming attempt's own photo is the one actually kept, not this one.
        // Surfacing this interim state (rather than leaving the status text unchanged) is what
        // actually addresses "doesn't feel like it's working": the operator sees the app react the
        // instant it notices something, not just a static "Scanning…" the whole time.
        await FileSystem.deleteAsync(outputPath, { idempotent: true });
        isCapturingRef.current = false;
        setStatusText('Hold steady — confirming…');
        scheduleNextAutoScan();
        return;
      }

      // Inconclusive — breaks any confirmation streak in progress, so a fluky one-off confident
      // read can't be completed by an unrelated later attempt. Still worth telling the operator
      // WHY it's inconclusive when there's real signal to go on (see distanceGuidance) instead of
      // leaving them staring at a static "Scanning…" the whole time.
      confirmStreak.current = 0;
      await FileSystem.deleteAsync(outputPath, { idempotent: true });
      isCapturingRef.current = false;
      setStatusText(distanceGuidance(bestScore, matchedScale));
      scheduleNextAutoScan();
    } catch (e) {
      confirmStreak.current = 0;
      isCapturingRef.current = false;
      setStatusText('Scanning for kit…');
      scheduleNextAutoScan();
    }
  };

  /** "Take Picture" — one manual capture, no analysis. The operator enters the result by hand on
   *  the next screen. Only relevant to mode "manual" — mode "scan" never renders this button, so
   *  there's nothing to stop here the way there was when both actions lived on one screen. */
  const onTakePicture = async () => {
    if (isCapturingRef.current || !cameraRef.current || !record.id) return;
    isCapturingRef.current = true;
    setIsCapturing(true);
    try {
      // shutterSound: false — matches the rest of this screen staying silent while scanning; a
      // brief white flash (see captureFlash) stands in as the visual "yes, that captured"
      // confirmation instead, since silent + no confirmation at all read as "nothing happened."
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9, shutterSound: false });
      if (!photo) throw new Error('No photo returned');
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setCaptureFlash(true);
      setTimeout(() => setCaptureFlash(false), 200);
      const outputPath = await newPhotoFilePath(record.id, 'drug_test_photo');
      await saveCassetteCrop(photo, computeSearchRectFraction(), outputPath);
      deliverResult(outputPath, false, false);
    } catch (e) {
      isCapturingRef.current = false;
      setIsCapturing(false);
      setStatusText('Could not capture photo — please try again');
    }
  };

  const onCameraReady = () => {
    // Ensure the per-record media directory exists before takePictureAsync's copy step needs it.
    if (record.id) void mediaDir(record.id);
    setCameraReady(true);
    // mode "scan" was already the operator's explicit choice on the previous screen (see this
    // screen's own doc) — no second "Scan Kit" tap needed here, it starts the moment the camera
    // can actually take a picture.
    if (mode === 'scan') onScanKit();
  };

  // Same camera-icon-plus-message idle convention used everywhere else in the app before a photo
  // exists (see DrugTestPictureScreen's own placeholder) — a blank screen while the permission
  // prompt/camera is still starting up read as broken rather than "loading."
  if (!permission) {
    return (
      <View style={styles.center}>
        <MaterialIcons name="camera-alt" size={40} color={colors.white} />
        <Text style={styles.permissionText}>Starting camera…</Text>
      </View>
    );
  }
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <MaterialIcons name="camera-alt" size={40} color={colors.white} />
        <Text style={styles.permissionText}>Camera permission is required to take this photo</Text>
      </View>
    );
  }

  const onCancel = () => {
    stopAutoScan();
    navigation.goBack();
  };

  return (
    <View style={styles.container}>
      <View style={[styles.frameWrapper, { width: frameWidth, height: frameHeight }]}>
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" onCameraReady={onCameraReady} />
        <CassetteGuideOverlay width={frameWidth} height={frameHeight} scanning={scanning} />
      </View>

      {/* Close button lives INSIDE the status bar row (not a separately-positioned absolute
          element) specifically so the two can never overlap and fight for touches — they
          previously sat at two independently-computed vertical offsets that landed almost on top
          of each other on real devices, making the close button untappable. The status message
          itself is purely informational: nothing here ever dismisses or clears it except a new
          status replacing it — tapping the X only ever exits the screen. */}
      <View style={[styles.statusBar, { paddingTop: 12 + insets.top }, detected && styles.statusBarDetected]}>
        <Pressable onPress={onCancel} disabled={isCapturing} hitSlop={12} style={styles.statusBarClose}>
          <MaterialIcons name="close" size={22} color={colors.white} />
        </Pressable>
        <View style={styles.statusBarContent}>
          <MaterialIcons
            name={detected ? 'check-circle' : 'center-focus-strong'}
            size={18}
            color={colors.white}
            style={styles.statusIcon}
          />
          <Text style={styles.statusText}>{statusText}</Text>
        </View>
        <View style={styles.statusBarClose} pointerEvents="none" />
      </View>

      {detected && (
        <View style={styles.successBadge} pointerEvents="none">
          <MaterialIcons name="check-circle" size={72} color={colors.white} />
        </View>
      )}

      {captureFlash && <View style={styles.captureFlash} pointerEvents="none" />}

      <View style={[styles.bottomBar, { bottom: 24 + insets.bottom }]}>
        {mode === 'scan' ? (
          <Pressable style={[styles.cancelButton, isCapturing && styles.disabledButton]} onPress={onCancel} disabled={isCapturing}>
            <MaterialIcons name="close" size={18} color={colors.white} />
            <Text style={styles.cancelButtonText}>Cancel scan</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.shutterButton, (!cameraReady || isCapturing) && styles.disabledButton]}
            onPress={() => void onTakePicture()}
            disabled={!cameraReady || isCapturing}
          >
            {isCapturing ? <ActivityIndicator color={colors.white} /> : <MaterialIcons name="camera-alt" size={30} color={colors.white} />}
          </Pressable>
        )}
      </View>

      <CassetteAnalyzerBridge ref={analyzerRef} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.black },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.black, gap: 12 },
  permissionText: { color: colors.white, textAlign: 'center' },
  frameWrapper: { alignSelf: 'center', position: 'absolute', top: 0, bottom: 0 },
  statusBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 12,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusBarDetected: { backgroundColor: 'rgba(46,125,50,0.85)' },
  statusBarClose: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  statusBarContent: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  statusIcon: { marginRight: 8 },
  statusText: { color: colors.white, textAlign: 'center', fontSize: 14, flexShrink: 1 },
  successBadge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureFlash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.white,
  },
  bottomBar: { position: 'absolute', left: 20, right: 20, alignItems: 'center' },
  shutterButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.brandAccent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  cancelButton: {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    paddingHorizontal: 20,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    gap: 8,
  },
  cancelButtonText: { color: colors.white, fontSize: 14, fontWeight: '600' },
  disabledButton: { opacity: 0.5 },
});
