import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import { MaterialIcons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useIsFocused, CommonActions } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/types';
import { useWorkflow } from '../hooks/WorkflowContext';
import { newPhotoFilePath, mediaDir } from '../services/fileStorage';
import CassetteGuideOverlay, { computeSearchRectFraction, GuideRectFraction } from '../components/CassetteGuideOverlay';
import { useCassetteFrameProcessor, CassetteFrameResult } from '../hooks/useCassetteFrameProcessor';
import { isConfidentlyDetected, applyReadingTo } from '../models/CassetteReading';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'DrugCassetteScan'>;

const CAMERA_FRAME_ASPECT_RATIO = 3 / 4; // width / height, portrait — mirrors the native constant

const IDLE_STATUS_TEXT = "Align the cassette's result window inside the frame";
/** How many consecutive ANALYZED FRAMES (not camera frames — see useCassetteFrameProcessor's own
 *  throttling) have to each independently pass isConfidentlyDetected() before it's trusted — same
 *  defense this was always built for (see the original doc this comment replaces), now guarding
 *  a continuous live stream instead of a periodic still-capture loop: a real cassette held steady
 *  keeps reading confidently frame after frame, while a stray false positive on unrelated content
 *  has no reason to keep independently re-clearing the SAME bar as the operator's hand naturally
 *  drifts slightly between frames.
 *
 *  Raised from 2 -> 6 after real-device testing found every confirmed false positive this session
 *  (a light fixture, cabinet trim, a laptop screen showing text) needed only ~800ms of held-still
 *  aim to trigger — easily satisfied by a brief accidental pause while repositioning the camera
 *  toward the actual kit, not just a deliberate hold. At MIN_FRAME_GAP_MS=400ms this now requires
 *  ~2.4s of unbroken confident reads, which is still a normal "hold it steady a moment" scan
 *  gesture but meaningfully harder to satisfy by accident than under a second was. This doesn't
 *  change what counts as a confident READING (see realtimeCassetteAnalyzer.ts's own doc for that
 *  ceiling) -- it only makes the live stream slower to trust a brief spike, which is a genuinely
 *  live-specific defense a single still photo never had access to. */
const CONSECUTIVE_CONFIRMATIONS_REQUIRED = 6;
/** How long the "Kit detected!" success flash holds before handing off to DrugTestPicture — just
 *  long enough to register as a distinct moment (like a barcode scanner's beep-and-flash) rather
 *  than the screen instantly cutting away, which read as an abrupt glitch rather than a
 *  deliberate "got it" confirmation. */
const SUCCESS_FLASH_MS = 450;

const FAR_SCALE_THRESHOLD = 0.4;
const CLOSE_SCALE_THRESHOLD = 0.8;
const NO_SIGNAL_SCORE = -1;

/** Turns one analyzed frame's raw search result into on-screen guidance — deliberately only
 *  speaks when there's a real signal to ground it in (bestScore > NO_SIGNAL_SCORE, i.e. some
 *  candidate really did read both control lines as present somewhere), never fabricating a
 *  direction from a best-of-nothing candidate that the search always returns regardless. */
function distanceGuidance(result: CassetteFrameResult): string {
  if (result.tooBusyGlobally) return 'Point the camera at just the cassette';
  if (result.bestScore <= NO_SIGNAL_SCORE || result.matchedScale == null) return 'Scanning for kit…';
  if (result.matchedScale <= FAR_SCALE_THRESHOLD) return 'Move the kit closer';
  if (result.matchedScale >= CLOSE_SCALE_THRESHOLD) return "Move the kit back a little — it's too close";
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
 * - mode "scan": a genuine real-time scanner — a frame processor (see
 *   useCassetteFrameProcessor.ts) runs the full detection algorithm (see
 *   realtimeCassetteAnalyzer.ts, a worklet-compatible port of cassetteAnalyzerHtml.ts) directly
 *   against the live camera feed, several times per second, the whole time the camera is pointed
 *   at anything — not a periodic "take a still photo, analyze it, wait, repeat" loop the way this
 *   screen worked before. Once a CONFIDENT reading (see CassetteReading#isConfidentlyDetected) is
 *   found on CONSECUTIVE_CONFIRMATIONS_REQUIRED analyzed frames in a row, ONE real photo is taken
 *   (to become the record's saved/displayed image — the live frames themselves are never saved,
 *   only analyzed) and the already-known result is applied to it.
 * - mode "manual": one manual capture, no analysis at all, triggered by a single shutter button —
 *   the operator enters the result by hand on the next screen.
 *
 * Migrated off expo-camera onto react-native-vision-camera specifically to make mode "scan" a
 * genuine real-time scanner (per explicit, repeated client direction) instead of the
 * still-photo-loop this screen used before. Extensively validated on real devices across this
 * session — the frame processor's orientation handling, the false-positive gates, and the
 * still-photo capture/crop pipeline (see saveCassetteCrop's own doc for that one's specific
 * history) were each debugged against real on-device logs and confirmed working, not left as
 * theoretical. See useCassetteFrameProcessor.ts's own doc for the current state of that piece.
 */
export default function DrugCassetteScanScreen({ navigation, route }: Props) {
  const mode = route.params.mode;
  const { record } = useWorkflow();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const device = useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();
  // React Navigation's native-stack does NOT unmount a screen just because another screen was
  // pushed on top of it -- it stays mounted, only hidden. `isActive={true}` unconditionally kept
  // the vision-camera session (and the OS-level camera hardware lock) alive the whole time this
  // screen was merely sitting underneath DrugResult/AlcoholTest, which is exactly why the alcohol
  // test's own camera (a separate expo-image-picker native camera intent) failed with
  // "device/camera-already-in-use" -- confirmed via the real on-device error. Tying isActive to
  // focus releases the hardware the moment the operator navigates away, same as vision-camera's
  // own docs recommend for any screen that isn't a permanent full-time camera view.
  const isFocused = useIsFocused();
  const [cameraReady, setCameraReady] = useState(false);
  const [scanning, setScanning] = useState(mode === 'scan');
  const [isCapturing, setIsCapturing] = useState(false);
  const [statusText, setStatusText] = useState(
    mode === 'manual' ? "Center the cassette's result window, then tap to capture" : IDLE_STATUS_TEXT
  );
  const [detected, setDetected] = useState(false);
  const [captureFlash, setCaptureFlash] = useState(false);
  // Bumped to force the <Camera> to fully unmount and remount (via its `key` prop) after a
  // transient hardware-session error. Confirmed via real on-device logs: a fast rescan (this
  // screen unmounting and a brand-new instance mounting again within ~2s) can race the PREVIOUS
  // camera session's own async native teardown, which is still in flight when the NEW session
  // tries to open -- CameraX then throws session/invalid-output-configuration or
  // device/camera-already-in-use, neither of which vision-camera recovers from on its own. A
  // short delay-then-remount reliably gives the old session time to actually finish releasing the
  // hardware; capped at 3 attempts so a genuinely unavailable camera (permission revoked, real
  // hardware fault) surfaces as an error instead of retrying forever.
  const [cameraRetryKey, setCameraRetryKey] = useState(0);
  const cameraRetryCount = useRef(0);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const onCameraError = useCallback((error: { code: string; message: string }) => {
    const transient = error.code === 'session/invalid-output-configuration' || error.code === 'device/camera-already-in-use';
    if (transient && cameraRetryCount.current < 3) {
      cameraRetryCount.current += 1;
      setCameraReady(false);
      setStatusText('Reconnecting camera…');
      setTimeout(() => setCameraRetryKey((k) => k + 1), 600);
      return;
    }
    setCameraError(`Camera error: ${error.message}`);
  }, []);

  const cameraRef = useRef<Camera>(null);
  const confirmStreak = useRef(0);
  // Guards against the frame processor's own worklet-thread throttling still delivering one more
  // in-flight result AFTER a confirmed detection has already started the async finish sequence
  // below (takePhoto + navigate) — without this, a second confirmed frame landing mid-finish could
  // re-enter the same sequence a second time.
  const finishingRef = useRef(false);

  useEffect(() => {
    if (!hasPermission) void requestPermission();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPermission]);

  // Letterboxed 4:3 frame within the screen — the Camera view is sized to exactly this rect, which
  // is what lets CassetteGuideOverlay's fraction math apply directly with no separate "camera
  // frame within a bigger view" step (see that component's own doc).
  let frameWidth: number, frameHeight: number;
  if (screenWidth / screenHeight > CAMERA_FRAME_ASPECT_RATIO) {
    frameHeight = screenHeight;
    frameWidth = frameHeight * CAMERA_FRAME_ASPECT_RATIO;
  } else {
    frameWidth = screenWidth;
    frameHeight = frameWidth / CAMERA_FRAME_ASPECT_RATIO;
  }

  /** Overwrites `outputPath` with just the wide search area (see computeSearchRectFraction) cut
   *  out of the raw capture — trims away most of the surrounding scene the camera sensor actually
   *  saw beyond that. The search area is always axis-aligned and a fixed size relative to the
   *  frame, generous enough that a real capture whose framing was good enough to actually get
   *  detected essentially always has the whole cassette within it.
   *
   *  Real on-device crash (confirmed via adb logcat across THREE rounds, not guessed): "x + width
   *  must be <= bitmap.width()" from ImageManipulator's native crop, reproducing on every single
   *  attempt on this device. Two earlier fixes here (a rounding fix, then a photo.orientation-based
   *  width/height swap modeled on the live frame processor's own orientation handling) both failed
   *  to resolve it -- meaning BOTH were guesses about what ImageManipulator's crop step actually
   *  sees, built on an unverified assumption that PhotoFile's width/height/orientation fields
   *  predict it. Rather than guess a third time, this now ASKS THE LIBRARY DIRECTLY: an empty-action
   *  manipulateAsync call first reads back the actual bitmap dimensions ImageManipulator itself will
   *  crop against, and the crop rectangle is computed from THOSE numbers -- removing the dependency
   *  on PhotoFile's own metadata (and whatever orientation/rotation handling does or doesn't happen
   *  between capture and crop) entirely. Whatever the real bitmap size turns out to be, the crop
   *  rectangle is now mathematically guaranteed to fit inside it. */
  const saveCassetteCrop = async (photoUri: string, searchFraction: GuideRectFraction, outputPath: string) => {
    const probe = await ImageManipulator.manipulateAsync(photoUri, [], {});
    const photoWidth = probe.width;
    const photoHeight = probe.height;
    console.log('[CassetteScan] saveCassetteCrop: actual bitmap =', photoWidth, 'x', photoHeight);
    const originX = Math.max(0, Math.min(photoWidth, Math.round(searchFraction.left * photoWidth)));
    const originY = Math.max(0, Math.min(photoHeight, Math.round(searchFraction.top * photoHeight)));
    const endX = Math.max(originX, Math.min(photoWidth, Math.round(searchFraction.right * photoWidth)));
    const endY = Math.max(originY, Math.min(photoHeight, Math.round(searchFraction.bottom * photoHeight)));
    const width = Math.max(1, endX - originX);
    const height = Math.max(1, endY - originY);
    const result = await ImageManipulator.manipulateAsync(
      probe.uri,
      [{ crop: { originX, originY, width, height } }],
      { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG }
    );
    await FileSystem.copyAsync({ from: result.uri, to: outputPath });
  };

  // See DrugCassetteScan's own param doc (navigation/types.ts) for why this is goBack-based via
  // an explicit route key rather than navigate({..., merge: true}) -- that pattern was confirmed,
  // via real on-device nav-stack logging, to NOT reliably collapse back onto the calling
  // DrugTestPicture screen once DrugResult had been visited and popped in between two scan
  // attempts, silently growing the stack by a full pair on every retry instead.
  const deliverResult = (photoPath: string, readValid: boolean, detectionAttempted: boolean) => {
    navigation.dispatch({
      ...CommonActions.setParams({ photoPath, readValid, detectionAttempted, scanAt: Date.now() }),
      source: route.params.returnToKey,
    });
    navigation.goBack();
  };

  const onCancel = useCallback(() => {
    setScanning(false);
    navigation.goBack();
  }, [navigation]);

  /** Called on the JS thread (hopped from the frame processor's worklet thread — see
   *  useCassetteFrameProcessor) for every analyzed frame while mode is "scan". Mirrors what
   *  runCaptureAttempt used to do per still-photo attempt, just fed by live frames instead. */
  const onFrameResult = useCallback(
    (result: CassetteFrameResult) => {
      if (finishingRef.current || !record.id) return;

      const valid = !!result.reading && isConfidentlyDetected(result.reading);
      if (valid && result.reading) {
        confirmStreak.current += 1;

        if (confirmStreak.current >= CONSECUTIVE_CONFIRMATIONS_REQUIRED) {
          finishingRef.current = true;
          void finishConfirmedScan(result.reading);
          return;
        }

        setStatusText(`Hold steady — confirming… (${confirmStreak.current}/${CONSECUTIVE_CONFIRMATIONS_REQUIRED})`);
        return;
      }

      confirmStreak.current = 0;
      setStatusText(distanceGuidance(result));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [record.id]
  );

  /** Wraps cameraRef.current.takePhoto() with one retry after a short delay. Real client report
   *  (production APK, not this dev environment, so no live logs to confirm the exact native error):
   *  backing out of Scan Kit and immediately tapping Take Picture remounts a fresh <Camera> --
   *  cameraRef.current becomes non-null the instant the component mounts, well before the native
   *  camera session has actually finished settling enough to serve a capture, so a quick tap right
   *  after switching modes can hit takePhoto() mid-startup and fail with "Could not capture photo".
   *  Same underlying race as the session/invalid-output-configuration retry already added to
   *  onError above, just surfacing through takePhoto() itself instead of the session's own error
   *  callback -- a single retry after letting the session settle covers both. */
  const takePhotoWithRetry = async () => {
    try {
      return await cameraRef.current!.takePhoto({ enableShutterSound: false });
    } catch (e) {
      await sleep(400);
      return await cameraRef.current!.takePhoto({ enableShutterSound: false });
    }
  };

  /** Runs once, the moment CONSECUTIVE_CONFIRMATIONS_REQUIRED live frames in a row have
   *  confidently agreed — takes the ONE real photo that becomes the record's saved image (the
   *  live frames themselves were only ever analyzed, never saved), applies the already-known
   *  result to it, and hands off. Mirrors the still-photo version's own "confirmed" branch. */
  const finishConfirmedScan = async (reading: NonNullable<CassetteFrameResult['reading']>) => {
    if (!cameraRef.current || !record.id) {
      finishingRef.current = false;
      return;
    }
    try {
      setScanning(false);
      setDetected(true);
      setStatusText('Kit detected!');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await sleep(SUCCESS_FLASH_MS);

      const photo = await takePhotoWithRetry();
      const outputPath = await newPhotoFilePath(record.id, 'drug_test_photo');
      await saveCassetteCrop(`file://${photo.path}`, computeSearchRectFraction(), outputPath);

      applyReadingTo(reading, record.drugResult);
      record.drugResult.autoDetected = true;
      deliverResult(outputPath, true, true);
    } catch (e) {
      // A real capture failure at the very last step — rare, but leaves the operator stuck
      // staring at a "Kit detected!" flash with nothing happening otherwise. Fall back to
      // re-arming the live scan rather than silently doing nothing.
      finishingRef.current = false;
      setDetected(false);
      confirmStreak.current = 0;
      setScanning(true);
      setStatusText('Could not capture photo — still scanning');
    }
  };

  const frameProcessor = useCassetteFrameProcessor(mode === 'scan' && scanning && !finishingRef.current, onFrameResult);

  /** "Take Picture" — one manual capture, no analysis. The operator enters the result by hand on
   *  the next screen. Only relevant to mode "manual" — mode "scan" never renders this button.
   *
   *  Uses vision-camera, same as scan mode -- an earlier version of this routed manual capture
   *  through expo-image-picker's native camera intent instead, on the theory that vision-camera's
   *  own capture pipeline was somehow the problem. Real on-device logs (adb logcat, not guessed)
   *  eventually traced the actual crash to saveCassetteCrop's own crop-bounds math (see that
   *  function's own doc for the full history of what was tried and ruled out there) -- a bug that
   *  affected scan mode's own capture-on-confirm equally, just silently caught there instead of
   *  surfacing as a hard error. Now that the actual root cause is fixed at the source, there's no
   *  remaining reason for manual mode to avoid vision-camera, and reverting back to it restores the
   *  auto-crop-to-search-region behavior (consistent framing with scan mode's captures) that the
   *  image-picker detour had given up. */
  const onTakePicture = async () => {
    // cameraReady (not just cameraRef.current) matters here specifically: the ref is set the
    // instant <Camera> mounts, well before the native session has actually finished starting --
    // see takePhotoWithRetry's own doc for the real client report this came from.
    if (isCapturing || !cameraRef.current || !cameraReady || !record.id) return;
    setIsCapturing(true);
    try {
      // enableShutterSound: false — matches the rest of this screen staying silent; a brief white
      // flash (see captureFlash) stands in as the visual "yes, that captured" confirmation
      // instead, since silent + no confirmation at all read as "nothing happened."
      const photo = await takePhotoWithRetry();
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setCaptureFlash(true);
      setTimeout(() => setCaptureFlash(false), 200);
      const outputPath = await newPhotoFilePath(record.id, 'drug_test_photo');
      await saveCassetteCrop(`file://${photo.path}`, computeSearchRectFraction(), outputPath);
      deliverResult(outputPath, false, false);
    } catch (e) {
      console.log('[CassetteScan] onTakePicture failed after retry:', e);
      setIsCapturing(false);
      setStatusText('Could not capture photo — please try again');
    }
  };

  const onCameraInitialized = () => {
    if (record.id) void mediaDir(record.id);
    cameraRetryCount.current = 0;
    setCameraReady(true);
  };

  // Same camera-icon-plus-message idle convention used everywhere else in the app before a photo
  // exists (see DrugTestPictureScreen's own placeholder) — a blank screen while the permission
  // prompt/device is still resolving read as broken rather than "loading."
  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <MaterialIcons name="camera-alt" size={40} color={colors.white} />
        <Text style={styles.permissionText}>Camera permission is required to take this photo</Text>
      </View>
    );
  }
  if (!device) {
    return (
      <View style={styles.center}>
        <MaterialIcons name="camera-alt" size={40} color={colors.white} />
        <Text style={styles.permissionText}>Starting camera…</Text>
      </View>
    );
  }
  if (cameraError) {
    return (
      <View style={styles.center}>
        <MaterialIcons name="camera-alt" size={40} color={colors.white} />
        <Text style={styles.permissionText}>{cameraError}</Text>
        <Pressable
          style={styles.retryButton}
          onPress={() => {
            cameraRetryCount.current = 0;
            setCameraError(null);
            setCameraRetryKey((k) => k + 1);
          }}
        >
          <Text style={styles.retryButtonText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.frameWrapper, { width: frameWidth, height: frameHeight }]}>
        <Camera
          key={cameraRetryKey}
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={isFocused}
          photo={true}
          pixelFormat="yuv"
          frameProcessor={mode === 'scan' ? frameProcessor : undefined}
          onInitialized={onCameraInitialized}
          onError={onCameraError}
        />
        <CassetteGuideOverlay width={frameWidth} height={frameHeight} scanning={scanning} />
      </View>

      {/* Close button lives INSIDE the status bar row (not a separately-positioned absolute
          element) specifically so the two can never overlap and fight for touches — see this
          screen's git history for the real-device overlap bug this fixed. The status message
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.black },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.black, gap: 12 },
  permissionText: { color: colors.white, textAlign: 'center' },
  retryButton: { backgroundColor: colors.brandPrimary, paddingVertical: 10, paddingHorizontal: 24, borderRadius: 8, marginTop: 8 },
  retryButtonText: { color: colors.white, fontWeight: '600' },
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
