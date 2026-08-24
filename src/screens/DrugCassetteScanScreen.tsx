import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import { CameraView, useCameraPermissions, CameraCapturedPicture } from 'expo-camera';
import { MaterialIcons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
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

/**
 * The camera opens as a live viewfinder with the cassette guide overlay and immediately starts
 * scanning in the background: every ~1.5s it silently takes a photo, crops it to a wide area
 * around the guide box (see CassetteGuideOverlay#computeSearchRectFraction), and searches that
 * area across several distances/tilts for the cassette (see CassetteAnalyzerBridge and
 * cassetteAnalyzerHtml.ts#searchAndAnalyze) rather than assuming it exactly fills the guide box —
 * once a CONFIDENT reading (see CassetteReading#isConfidentlyDetected: both control lines present
 * with a real confidence margin) is found on CONSECUTIVE_CONFIRMATIONS_REQUIRED attempts in a
 * row, that attempt's raw capture is cropped down to just its own wide search area (see
 * saveCassetteCrop) — trimming away the surrounding scene without risking cutting off part of
 * the cassette the way the analyzer's own internal (tighter, sometimes rotated/rescaled)
 * candidate crop could — and that becomes the saved/displayed photo, with the result auto-filled
 * as if the operator had captured it themselves. Failed background attempts are discarded (no
 * visible photo shown, no status flicker) and it just keeps trying. The operator can tap "Skip
 * auto-detect" at any point for the same search-area crop with no analysis at all — a manual
 * fallback for when auto-detect is struggling. That stops the background scanning.
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
export default function DrugCassetteScanScreen({ navigation }: Props) {
  const { record } = useWorkflow();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const [isCapturing, setIsCapturing] = useState(false);
  const [statusText, setStatusText] = useState(IDLE_STATUS_TEXT);

  const cameraRef = useRef<CameraView>(null);
  const analyzerRef = useRef<CassetteAnalyzerHandle>(null);
  const isCapturingRef = useRef(false);
  const autoScanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoScanStopped = useRef(false);
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
    if (autoScanTimer.current) {
      clearTimeout(autoScanTimer.current);
      autoScanTimer.current = null;
    }
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
      const { reading } = await (analyzerRef.current?.cropAndAnalyze(outputPath, searchFraction) ??
        Promise.resolve({ reading: null }));

      const valid = !!reading && isConfidentlyDetected(reading);
      if (valid && reading) {
        confirmStreak.current += 1;

        if (confirmStreak.current >= CONSECUTIVE_CONFIRMATIONS_REQUIRED) {
          applyReadingTo(reading, record.drugResult);
          record.drugResult.autoDetected = true;
          stopAutoScan();
          await saveCassetteCrop(photo, searchFraction, outputPath);
          deliverResult(outputPath, true, true);
          return;
        }

        // A confident read, but not yet enough in a row (see CONSECUTIVE_CONFIRMATIONS_REQUIRED's
        // own doc) — the confirming attempt's own photo is the one actually kept, not this one.
        await FileSystem.deleteAsync(outputPath, { idempotent: true });
        isCapturingRef.current = false;
        scheduleNextAutoScan();
        return;
      }

      // Inconclusive — breaks any confirmation streak in progress, so a fluky one-off confident
      // read can't be completed by an unrelated later attempt.
      confirmStreak.current = 0;
      await FileSystem.deleteAsync(outputPath, { idempotent: true });
      isCapturingRef.current = false;
      scheduleNextAutoScan();
    } catch (e) {
      confirmStreak.current = 0;
      isCapturingRef.current = false;
      scheduleNextAutoScan();
    }
  };

  const skipAutoDetect = async () => {
    stopAutoScan();
    if (isCapturingRef.current || !cameraRef.current || !record.id) return;
    isCapturingRef.current = true;
    setIsCapturing(true);
    try {
      // shutterSound: false — matches the rest of this screen staying silent while scanning.
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9, shutterSound: false });
      if (!photo) throw new Error('No photo returned');
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
    autoScanStopped.current = false;
    autoScanTimer.current = setTimeout(() => {
      void runCaptureAttempt();
    }, AUTO_SCAN_INITIAL_DELAY_MS);
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

  return (
    <View style={styles.container}>
      <View style={[styles.frameWrapper, { width: frameWidth, height: frameHeight }]}>
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" onCameraReady={onCameraReady} />
        <CassetteGuideOverlay width={frameWidth} height={frameHeight} />
      </View>

      <View style={styles.statusBar}>
        <MaterialIcons name="center-focus-strong" size={18} color={colors.white} style={styles.statusIcon} />
        <Text style={styles.statusText}>{statusText}</Text>
      </View>

      <View style={styles.bottomBar}>
        <Pressable
          style={[styles.skipButton, isCapturing && styles.disabledButton]}
          onPress={() => void skipAutoDetect()}
          disabled={isCapturing}
        >
          <Text style={styles.skipButtonText}>Skip auto-detect — take a plain photo instead</Text>
        </Pressable>
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
    top: 50,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusIcon: { marginRight: 8 },
  statusText: { color: colors.white, textAlign: 'center', fontSize: 14, flexShrink: 1 },
  bottomBar: { position: 'absolute', left: 20, right: 20, bottom: 24 },
  skipButton: { height: 44, alignItems: 'center', justifyContent: 'center', padding: 8 },
  skipButtonText: { color: colors.white, fontSize: 13 },
  disabledButton: { opacity: 0.5 },
});
