import type { Frame } from 'react-native-vision-camera';
import { useFrameProcessor } from 'react-native-vision-camera';
import { useRunOnJS, useSharedValue } from 'react-native-worklets-core';
import { analyzeSearchCrop, RealtimeAnalysisResult } from '../services/realtimeCassetteAnalyzer';
import { computeSearchRectFraction } from '../components/CassetteGuideOverlay';

// Computed once at module load — pure, screen-size-independent fraction math (see
// CassetteGuideOverlay's own doc) — and captured directly as a plain constant in the frame
// processor worklet's closure below, rather than recomputed or read from a mutable ref per call:
// worklets run on a separate JS runtime and only reliably see outer values as they were AT THE
// TIME the worklet itself was created — mutating a plain ref's `.current` on the JS thread
// afterward does NOT propagate across that runtime boundary the way a normal same-thread closure
// would. A value that's simply constant for the app's lifetime, like this one, just needs to be
// captured once; only genuinely cross-thread-LIVE values (see lastProcessedAt below) need
// `useSharedValue`.
const SEARCH_FRACTION = computeSearchRectFraction();

/** Minimum gap between two analyzed frames — running the full multi-scale search on every single
 *  camera frame (30-60fps) would never keep up; this throttles it to a still-frequent-enough rate
 *  that live guidance ("move closer", "hold steady") feels continuous, without stalling the frame
 *  pipeline. Raised from an initial 250ms after a real-device report of the scanner "stucking" —
 *  250ms gave the GPU→CPU frame copy (toArrayBuffer) plus the multi-candidate search less headroom
 *  than a slower device actually needs between attempts, similar in spirit to why the old
 *  still-photo loop's own retry delay existed at all. Still meaningfully more frequent than that
 *  old loop's ~900-1200ms cadence, so this stays real-time-reading even backed off. No device
 *  profiler was available to measure the ACTUAL per-frame cost directly — if it's still not
 *  smooth, that's the next thing to get real data on rather than guess further. */
const MIN_FRAME_GAP_MS = 400;

export type CassetteFrameResult = RealtimeAnalysisResult;

/**
 * Runs the full cassette-detection algorithm (see realtimeCassetteAnalyzer.ts) directly against
 * live camera frames — the actual "real-time scanner" mechanism, replacing the old periodic
 * takePictureAsync-and-analyze loop. Every ~MIN_FRAME_GAP_MS, extracts just the Y (luminance)
 * plane of the WIDE search-crop region (see CassetteGuideOverlay#computeSearchRectFraction) out of
 * the frame, runs analyzeSearchCrop on it, and hops back to the JS thread via useRunOnJS to
 * deliver the result to `onResult`.
 *
 * CONFIRMED via real-device `adb logcat` (not assumed): frame.orientation reports
 * 'landscape-right' on the tested device — the raw sensor buffer is delivered in the camera's
 * native landscape orientation (e.g. 640x480) regardless of the app being portrait-locked; only
 * the on-screen PREVIEW is rotated for display, not the raw buffer a frame processor reads. An
 * earlier version of this file assumed the raw buffer already arrived upright and applied the
 * guide box's fractional coordinates directly to frame.width/frame.height — since those axes are
 * actually swapped relative to what the operator sees, the "search crop" it extracted had no
 * reliable relationship to what was actually framed in the on-screen guide box, which is why the
 * scanner kept reacting to content nowhere near what it was pointed at. mapOutputToRaw below
 * transforms each pixel through the real rotation before reading it, so every axis lines up with
 * what's shown on screen again. Only 'landscape-right' has been confirmed against real log output;
 * 'landscape-left'/'portrait-upside-down' are handled by the same rotation math for the other 3
 * standard orientations but have not been individually observed on a device.
 *
 * @param onResult Must be a `useCallback`-stable reference (or inline-stable via the caller's own
 * memoization) — an `onResult` that's a fresh function identity every render forces the frame
 * processor worklet to be torn down and recreated on every render too, since it's captured by
 * `useRunOnJS`'s own dependency array.
 */
export function useCassetteFrameProcessor(active: boolean, onResult: (result: CassetteFrameResult) => void) {
  const lastProcessedAt = useSharedValue(0);

  const deliverResult = useRunOnJS((result: CassetteFrameResult) => {
    onResult(result);
  }, [onResult]);

  const frameProcessor = useFrameProcessor(
    (frame: Frame) => {
      'worklet';
      if (!active) return;

      const now = Date.now();
      if (now - lastProcessedAt.value < MIN_FRAME_GAP_MS) return;
      lastProcessedAt.value = now;

      if (frame.pixelFormat !== 'yuv') return; // see pixelFormat="yuv" on <Camera> — should never happen

      const frac = SEARCH_FRACTION;
      const buffer = frame.toArrayBuffer();
      const yPlane = new Uint8Array(buffer);
      const stride = frame.bytesPerRow > 0 ? frame.bytesPerRow : frame.width;

      // frame.width/frame.height are the RAW sensor buffer's own axes, not the upright axes the
      // operator sees on screen (see this hook's own top-level doc) — 'landscape-left'/'-right'
      // mean those two axes are swapped relative to the upright output, so the guide box's
      // fractions have to be measured against the SWAPPED (output) dimensions, not the raw ones.
      const swapped = frame.orientation === 'landscape-left' || frame.orientation === 'landscape-right';
      const outputWidth = swapped ? frame.height : frame.width;
      const outputHeight = swapped ? frame.width : frame.height;

      const left = Math.max(0, Math.round(frac.left * outputWidth));
      const top = Math.max(0, Math.round(frac.top * outputHeight));
      const right = Math.min(outputWidth, Math.round(frac.right * outputWidth));
      const bottom = Math.min(outputHeight, Math.round(frac.bottom * outputHeight));
      const cropWidth = Math.max(1, right - left);
      const cropHeight = Math.max(1, bottom - top);

      // Slice the search-crop region out of the full Y plane into a tightly-packed buffer, same
      // reasoning as extractRegion inside analyzeSearchCrop itself — but reading through the
      // rotation transform for frame.orientation instead of a plain contiguous sub-rectangle copy,
      // since an upright (outX, outY) crop pixel does NOT live at (outX, outY) in the raw buffer
      // unless orientation is already 'up'. Each of the 4 standard orientations is its own simple
      // loop (branch hoisted OUT of the per-pixel inner loop, not re-checked every iteration) —
      // derived from vision-camera's own documented semantics ('right' = raw rotated +90° CW from
      // upright, 'left' = raw rotated -90° CW i.e. +90° CCW, 'down' = 180°) and confirmed against
      // real device log output for the 'landscape-right' case specifically.
      const cropped = new Uint8Array(cropWidth * cropHeight);
      const rawWidth = frame.width;
      const rawHeight = frame.height;
      if (frame.orientation === 'landscape-right') {
        for (let cy = 0; cy < cropHeight; cy++) {
          const outY = top + cy;
          for (let cx = 0; cx < cropWidth; cx++) {
            const outX = left + cx;
            const rawX = rawWidth - 1 - outY;
            const rawY = outX;
            cropped[cy * cropWidth + cx] = yPlane[rawY * stride + rawX];
          }
        }
      } else if (frame.orientation === 'landscape-left') {
        for (let cy = 0; cy < cropHeight; cy++) {
          const outY = top + cy;
          for (let cx = 0; cx < cropWidth; cx++) {
            const outX = left + cx;
            const rawX = outY;
            const rawY = rawHeight - 1 - outX;
            cropped[cy * cropWidth + cx] = yPlane[rawY * stride + rawX];
          }
        }
      } else if (frame.orientation === 'portrait-upside-down') {
        for (let cy = 0; cy < cropHeight; cy++) {
          const outY = top + cy;
          for (let cx = 0; cx < cropWidth; cx++) {
            const outX = left + cx;
            const rawX = rawWidth - 1 - outX;
            const rawY = rawHeight - 1 - outY;
            cropped[cy * cropWidth + cx] = yPlane[rawY * stride + rawX];
          }
        }
      } else {
        // 'portrait' (already upright) — plain contiguous copy, same as before.
        for (let cy = 0; cy < cropHeight; cy++) {
          const srcStart = (top + cy) * stride + left;
          for (let cx = 0; cx < cropWidth; cx++) {
            cropped[cy * cropWidth + cx] = yPlane[srcStart + cx];
          }
        }
      }

      const result = analyzeSearchCrop(cropped, cropWidth, cropWidth, cropHeight);

      deliverResult(result);
    },
    [active, deliverResult]
  );

  return frameProcessor;
}
