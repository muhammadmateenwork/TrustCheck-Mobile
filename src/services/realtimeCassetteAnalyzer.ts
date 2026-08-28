import type { CassetteReading, LineReading, StripReading } from '../models/CassetteReading';

/**
 * Worklet-compatible cassette detection algorithm, running directly inside a
 * react-native-vision-camera frame processor (on live camera frames, on the worklet thread) —
 * replaced an earlier WebView-hosted version that only ever ran against a periodic still photo
 * (see DrugCassetteScanScreen's own doc on why that stopped short of a real real-time scanner);
 * that WebView version (cassetteAnalyzerHtml.ts) has since been deleted, fully superseded by this
 * file.
 *
 * Operates on a single-channel LUMINANCE (Y) plane instead of RGBA — requesting
 * `pixelFormat: 'yuv'` from the frame processor and reading only the Y plane, which is literally
 * what an RGBA approach would otherwise approximate via `(R+G+B)/3` for "lightness" and
 * `255 - min(R,G,B)` for "darkness". Using real luma directly is more accurate, not a compromise,
 * and sidesteps a real bug in this camera library's RGB/BGRA pixel conversion path — the
 * algorithm never used color, only lightness, so nothing is lost.
 *
 * Every function is marked 'worklet' so it can be called synchronously from the frame processor
 * worklet thread (see useCassetteFrameProcessor.ts) — Worklets can call other same-file worklet
 * functions directly, but NOT arbitrary non-worklet JS, hence every helper here needing its own
 * 'worklet' directive rather than just the top-level entry point. Note also that the worklets
 * babel plugin resolves same-file worklet-to-worklet calls by SOURCE ORDER, not normal JS
 * hoisting — a worklet must be declared before any other worklet that calls it, or the callee
 * reads as undefined at runtime (a real bug this file hit once — see git history).
 *
 * Detection accuracy, the false-positive gates (peak-density veto, global busyness gate,
 * transition-density gate, large-scale-fallback veto, isolated-peak flank check), and the frame
 * orientation handling have all been validated against real on-device logs this session, including
 * against real confirmed false positives (not just theorized) — see this file's own git history
 * and useCassetteFrameProcessor.ts's doc for the specifics.
 */

// ---- CassetteTemplate.java constants ----
const LEFT_STRIP_SUBSTANCES = ['MET', 'THC', 'OXY'];
const RIGHT_STRIP_SUBSTANCES = ['AMP', 'OPI', 'COC'];
const LEFT_STRIP_LEFT = 0.3;
const LEFT_STRIP_RIGHT = 0.47;
const RIGHT_STRIP_LEFT = 0.53;
const RIGHT_STRIP_RIGHT = 0.7;
const ROW_CENTERS_Y = [0.14, 0.38, 0.62, 0.86];
const LINE_BAND_HEIGHT = 0.14;
const GUIDE_ASPECT_RATIO = 0.68;

// ---- CassetteAnalyzer.java constants ----
const PRESENCE_THRESHOLD = 22;
const CONFIDENCE_MARGIN = 20;
const STRIP_SEARCH_MARGIN = 0.2;
const STRIP_LIGHTNESS_MARGIN = 10;
const MIN_STRIP_WIDTH_FRACTION = 0.06;
const MIN_WINDOW_HEIGHT_FRACTION = 0.18;
const LOCAL_BACKGROUND_MARGIN_FRACTION = 0.04;
const LOCAL_PRESENCE_THRESHOLD = 8;

// ---- Extra cross-checks — see cassetteAnalyzerHtml.ts's own doc for the full reasoning/history
// behind each of these; kept byte-for-byte identical here. ----
const ROW_ALIGNMENT_TOLERANCE = 0.12;
const MIN_WIDTH_CONSISTENCY_RATIO = 0.5;
const MIN_SHARPNESS = 3;
const MAX_PLAUSIBLE_LINE_PEAKS = 6;
// Tightened from 5 -> 4 after a real-device log showed a live false positive (cabinet/couch scene)
// score globalPeaks=5.0 exactly — the old `> 5` check let a peaks-of-5 frame straight through the
// gate, where the per-candidate search then found edge contrast strong enough to saturate
// detectLine's confidence to the maximum (bestScore=2.00) and get accepted. 4 still leaves the
// same real-cassette calibration data (18 real cassette photos, all well under 5) comfortably
// under the new threshold.
const MAX_GLOBAL_PEAKS = 4;

// SECOND global gate, alongside computeGlobalPeaks below — that one is a per-ROW average
// collapsed to 1D, which has a real blind spot: a 2D-symmetric pattern (a checkerboard, a tiled
// floor, a grid-patterned fabric) has roughly equal light/dark content in EVERY row AND every
// column, so collapsing either axis alone averages it away to near-zero peaks even though the
// image is extremely busy — found by actually testing a synthetic checkerboard through this exact
// pipeline, not theorized. This instead samples a coarse grid and counts BOTH horizontal and
// vertical adjacent-sample jumps as a fraction of samples checked, a true 2D measure no
// axis-symmetric pattern can hide from. Calibrated against 18 real cassette photos (max 0.055)
// vs. 3 real client-reported false positives (0.086-0.094) and synthetic checkerboards
// (0.156-0.648): a clean, wide separation with real margin on both sides.
// Tightened from 0.07 -> 0.058 after a real-device log showed the same cabinet/couch scene score
// 0.066 on one frame -- still under the original 0.07 threshold, so the gate let it through and it
// went on to score a confident (bestScore=2.00) false match. 0.058 keeps a small margin above the
// real-cassette calibration ceiling (0.055) while rejecting the observed 0.066 false positive with
// real headroom.
const MAX_TRANSITION_DENSITY = 0.058;

// Real-time search grid — deliberately SMALLER than the still-photo version's 3 rotations x 4
// scales x 5 y-offsets (60 candidates). This runs many times per second on live frames instead of
// once per ~1s still capture, so successive frames naturally sweep across slightly different
// hand positions/angles as the operator moves — the same coverage the still-photo version needed
// a wide single-shot grid for is instead built up across TIME here. Rotation is dropped entirely
// for the same reason (an operator not holding it straight sees it fail in real time and
// naturally straightens the phone, unlike the still-photo flow where they got no feedback during
// the ~1s a capture was in flight).
const SEARCH_SCALES = [0.65, 0.5, 0.35];
const SEARCH_Y_OFFSETS = [0, -0.15, 0.15];
// Large-scale-fallback veto threshold — see its use-site below for the full reasoning. Tied to
// whichever scale is actually LARGEST in SEARCH_SCALES above, not a hardcoded absolute value: a
// hardcoded 0.8 was silently DEAD CODE here specifically, because this real-time grid's largest
// tier (0.65) never reaches it — the exact mechanism that fixed the original still-photo false
// positive was never actually running in the real-time build until this was caught by testing
// against the real false-positive photos the client sent, not by re-reading the code.
const LARGE_SCALE_FALLBACK_VETO_THRESHOLD = Math.max(...SEARCH_SCALES);

function clampNum(v: number, lo: number, hi: number): number {
  'worklet';
  return Math.max(lo, Math.min(hi, v));
}

function median(arr: number[]): number {
  'worklet';
  const sorted = arr.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function findRange(lightnessArr: number[], searchLen: number, minFraction: number): [number, number] | null {
  'worklet';
  const thresh = median(lightnessArr) + STRIP_LIGHTNESS_MARGIN;
  let bestStart = -1;
  let bestLength = 0;
  let runStart = -1;
  for (let i = 0; i <= searchLen; i++) {
    const above = i < searchLen && lightnessArr[i] >= thresh;
    if (above) {
      if (runStart === -1) runStart = i;
    } else if (runStart !== -1) {
      const length = i - runStart;
      if (length > bestLength) {
        bestLength = length;
        bestStart = runStart;
      }
      runStart = -1;
    }
  }
  if (bestLength < searchLen * minFraction) return null;
  return [bestStart, bestStart + bestLength];
}

// `pixels` here is always a single-channel luminance buffer — one byte per pixel, row stride
// `stride` (which may exceed `width` due to camera buffer alignment/padding; ALWAYS index via
// stride, never assume stride === width).
function findStripColumnRange(
  pixels: Uint8Array,
  stride: number,
  height: number,
  searchLeft: number,
  searchRight: number
): [number, number] | null {
  'worklet';
  const searchWidth = searchRight - searchLeft;
  const colLightness: number[] = new Array(searchWidth);
  for (let x = 0; x < searchWidth; x++) {
    const col = searchLeft + x;
    let sum = 0;
    for (let y = 0; y < height; y++) {
      sum += pixels[y * stride + col];
    }
    colLightness[x] = sum / height;
  }
  const range = findRange(colLightness, searchWidth, MIN_STRIP_WIDTH_FRACTION);
  if (!range) return null;
  return [searchLeft + range[0], searchLeft + range[1]];
}

// Must be declared BEFORE any worklet that calls it (see findStripRowRange below) -- unlike plain
// JS function-declaration hoisting, react-native-worklets-core's babel plugin captures a same-file
// worklet-to-worklet call by source order: a worklet calling another worklet function declared
// LATER in the file gets `undefined` for it at runtime ("X is not a function"), even though a
// worklet declared AFTER this point calling it (see countProfilePeaks) works fine. Confirmed via a
// real on-device crash after adding a new call to this function from findStripRowRange while it
// was still declared below that call site; moving the declaration up here (its first real use)
// fixed it.
function smoothProfile(profile: number[], windowPx: number): number[] {
  'worklet';
  const half = Math.floor(windowPx / 2);
  const out: number[] = new Array(profile.length);
  for (let i = 0; i < profile.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j >= 0 && j < profile.length) {
        sum += profile[j];
        count++;
      }
    }
    out[i] = sum / count;
  }
  return out;
}

function findStripRowRange(pixels: Uint8Array, stride: number, height: number, left: number, right: number): [number, number] | null {
  'worklet';
  const stripWidth = Math.max(1, right - left);
  const rowLightness: number[] = new Array(height);
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = left; x < right; x++) {
      sum += pixels[y * stride + x];
    }
    rowLightness[y] = sum / stripWidth;
  }
  // Smoothed before run-finding -- the raw row-lightness profile dips at every printed line
  // (control + substance bands), which fragments what should be one long contiguous "bright
  // window" run into several short ones, so findRange's minFraction requirement almost never
  // succeeds even on a real cassette. Confirmed directly against real device data: `located`
  // (this function's own success/failure) measured false for EVERY real cassette photo in the
  // corpus before this fix -- the "membrane location" search had silently never worked, for real
  // cassettes OR false positives alike, the whole time this session. Smoothing first (same
  // technique countProfilePeaks already uses for peak-counting) merges those brief internal dips
  // without erasing genuine background boundaries, which are wider than the smoothing window.
  const smoothWindowPx = Math.max(3, Math.round(height * 0.025));
  const smoothed = smoothProfile(rowLightness, smoothWindowPx);
  return findRange(smoothed, height, MIN_WINDOW_HEIGHT_FRACTION);
}

// "Darkness" profile — with real luminance available directly, this is just `255 - Y`, matching
// what the RGBA version approximated via `255 - min(R,G,B)`.
function buildVerticalDarknessProfile(pixels: Uint8Array, stride: number, top: number, bottom: number, left: number, right: number): number[] {
  'worklet';
  const rangeHeight = Math.max(1, bottom - top);
  const stripWidth = Math.max(1, right - left);
  const profile: number[] = new Array(rangeHeight);
  for (let i = 0; i < rangeHeight; i++) {
    const y = top + i;
    let sum = 0;
    for (let x = left; x < right; x++) {
      sum += 255 - pixels[y * stride + x];
    }
    profile[i] = sum / stripWidth;
  }
  return profile;
}

function computeSharpness(pixels: Uint8Array, stride: number, width: number, height: number): number {
  'worklet';
  const stepX = Math.max(1, Math.floor(width / 60));
  const stepY = Math.max(1, Math.floor(height / 60));
  let total = 0;
  let count = 0;
  for (let y = 0; y < height; y += stepY) {
    let prevLum = -1;
    for (let x = 0; x < width; x += stepX) {
      const lum = pixels[y * stride + x];
      if (prevLum >= 0) {
        total += Math.abs(lum - prevLum);
        count++;
      }
      prevLum = lum;
    }
  }
  return count > 0 ? total / count : 0;
}

function countProfilePeaks(profile: number[], background: number): number {
  'worklet';
  const smoothWindowPx = Math.max(3, Math.round(profile.length * 0.025));
  const smoothed = smoothProfile(profile, smoothWindowPx);
  const threshold = background + PRESENCE_THRESHOLD;
  const minGapPx = Math.max(1, Math.round(profile.length * 0.03));
  let peaks = 0;
  let lastPeak = -Infinity;
  for (let y = 1; y < smoothed.length - 1; y++) {
    if (smoothed[y] >= threshold && smoothed[y] >= smoothed[y - 1] && smoothed[y] >= smoothed[y + 1] && y - lastPeak >= minGapPx) {
      peaks++;
      lastPeak = y;
    }
  }
  return peaks;
}

function computeGlobalPeaks(pixels: Uint8Array, stride: number, width: number, height: number): number {
  'worklet';
  const profile: number[] = new Array(height);
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < width; x++) {
      sum += 255 - pixels[y * stride + x];
    }
    profile[y] = sum / width;
  }
  const background = median(profile);
  return countProfilePeaks(profile, background);
}

// See MAX_TRANSITION_DENSITY's own doc — a true 2D busyness measure, catching axis-symmetric
// patterns (checkerboards, grids, tiled surfaces) that computeGlobalPeaks alone cannot.
function computeTransitionDensity(pixels: Uint8Array, stride: number, width: number, height: number): number {
  'worklet';
  const stepX = Math.max(1, Math.floor(width / 60));
  const stepY = Math.max(1, Math.floor(height / 60));
  let total = 0;
  let transitions = 0;
  for (let y = stepY; y < height; y += stepY) {
    for (let x = stepX; x < width; x += stepX) {
      const lum = pixels[y * stride + x];
      const leftLum = pixels[y * stride + (x - stepX)];
      const upLum = pixels[(y - stepY) * stride + x];
      total += 2;
      if (Math.abs(lum - leftLum) >= 60) transitions++;
      if (Math.abs(lum - upLum) >= 60) transitions++;
    }
  }
  return total > 0 ? transitions / total : 0;
}

function localNeighborLevel(profile: number[], bandFrom: number, bandTo: number, margin: number): number {
  'worklet';
  const neighbors: number[] = [];
  for (let y = bandFrom - margin; y < bandFrom; y++) if (y >= 0) neighbors.push(profile[y]);
  for (let y2 = bandTo + 1; y2 <= bandTo + margin; y2++) if (y2 < profile.length) neighbors.push(profile[y2]);
  if (neighbors.length === 0) {
    return profile[clampNum(Math.round((bandFrom + bandTo) / 2), 0, profile.length - 1)];
  }
  neighbors.sort((a, b) => a - b);
  return neighbors[Math.floor(neighbors.length / 2)];
}

// Same idea as localNeighborLevel, but kept SEPARATE per side instead of pooling both margins into
// one combined median. A real printed line is a narrow, ISOLATED darkness peak with lighter
// background on BOTH flanking sides; a strong single-edge light source (a ceiling light fixture
// produced a real, confirmed false positive from this exact gap) instead produces a monotonic
// step -- one side of the "peak" never actually drops off, it just keeps rising into the
// transition. Pooling both sides into one combined median can still average out to a
// plausible-looking contrast even when one side never drops at all, which is exactly how that
// false positive slipped through everything else (global busyness gates included -- a single
// strong light source in an otherwise plain scene isn't "busy"). Real-cassette calibration: the
// worst (lowest) one-sided drop measured across 11 real cassette photos pulled off-device was
// +4.5; the light-fixture false positive's worst one-sided drop, measured the same way against the
// EXACT frame the live scanner captured and mis-detected, was -4.0 (that flank was darker at the
// peak's own height than immediately outside the detection band -- it never dropped off at all).
// MIN_FLANK_DROP sits with real margin on both sides of that gap.
const MIN_FLANK_DROP = 2;
function oneSidedNeighborLevel(profile: number[], rangeStart: number, rangeEndExclusive: number): number | null {
  'worklet';
  const neighbors: number[] = [];
  for (let y = rangeStart; y < rangeEndExclusive; y++) {
    if (y >= 0 && y < profile.length) neighbors.push(profile[y]);
  }
  if (neighbors.length === 0) return null;
  neighbors.sort((a, b) => a - b);
  return neighbors[Math.floor(neighbors.length / 2)];
}

function detectLine(profile: number[], expectedYFraction: number, background: number): LineReading {
  'worklet';
  const height = profile.length;
  const center = Math.round(expectedYFraction * height);
  const band = Math.max(1, Math.round(LINE_BAND_HEIGHT * height));
  const half = Math.floor(band / 2);
  const from = clampNum(center - half, 0, height - 1);
  const to = clampNum(center + half, 0, height - 1);

  let peak = 0;
  for (let y = from; y <= to; y++) peak = Math.max(peak, profile[y]);
  const globalContrast = peak - background;

  const margin = Math.max(1, Math.round(LOCAL_BACKGROUND_MARGIN_FRACTION * height));
  const localLevel = localNeighborLevel(profile, from, to, margin);
  const localContrast = peak - localLevel;

  const beforeLevel = oneSidedNeighborLevel(profile, from - margin, from);
  const afterLevel = oneSidedNeighborLevel(profile, to + 1, to + 1 + margin);
  const dropBefore = beforeLevel === null ? Infinity : peak - beforeLevel;
  const dropAfter = afterLevel === null ? Infinity : peak - afterLevel;
  const isolatedPeak = dropBefore >= MIN_FLANK_DROP && dropAfter >= MIN_FLANK_DROP;

  const present = globalContrast >= PRESENCE_THRESHOLD && localContrast >= LOCAL_PRESENCE_THRESHOLD && isolatedPeak;
  const confidence = clampNum(Math.abs(globalContrast - PRESENCE_THRESHOLD) / CONFIDENCE_MARGIN, 0, 1);
  return { present, confidence };
}

interface InternalStripReading extends StripReading {
  rowTopFrac: number;
  rowBottomFrac: number;
  colWidthFrac: number;
}

function analyzeStrip(
  pixels: Uint8Array,
  stride: number,
  width: number,
  height: number,
  leftFrac: number,
  rightFrac: number,
  substances: string[]
): InternalStripReading {
  'worklet';
  const searchLeft = clampNum(Math.round((leftFrac - STRIP_SEARCH_MARGIN) * width), 0, width - 1);
  const searchRight = clampNum(Math.round((rightFrac + STRIP_SEARCH_MARGIN) * width), searchLeft + 1, width);

  const columns = findStripColumnRange(pixels, stride, height, searchLeft, searchRight);
  let leftPx: number, rightPx: number;
  if (columns) {
    leftPx = columns[0];
    rightPx = columns[1];
  } else {
    leftPx = clampNum(Math.round(leftFrac * width), 0, width - 1);
    rightPx = clampNum(Math.round(rightFrac * width), leftPx + 1, width);
  }

  const rows = findStripRowRange(pixels, stride, height, leftPx, rightPx);
  const topPx = rows ? rows[0] : 0;
  const bottomPx = rows ? rows[1] : height;

  const profile = buildVerticalDarknessProfile(pixels, stride, topPx, bottomPx, leftPx, rightPx);
  const background = median(profile);

  const tooBusy = countProfilePeaks(profile, background) > MAX_PLAUSIBLE_LINE_PEAKS;
  const NOT_PRESENT: LineReading = { present: false, confidence: 0 };

  const control = tooBusy ? NOT_PRESENT : detectLine(profile, ROW_CENTERS_Y[0], background);
  const substanceReadings: Record<string, LineReading> = {};
  for (let i = 0; i < substances.length; i++) {
    substanceReadings[substances[i]] = tooBusy ? NOT_PRESENT : detectLine(profile, ROW_CENTERS_Y[i + 1], background);
  }
  const located = !!(columns && rows);
  return {
    control,
    substances: substanceReadings,
    located,
    rowTopFrac: topPx / height,
    rowBottomFrac: bottomPx / height,
    colWidthFrac: (rightPx - leftPx) / width,
  };
}

function analyze(pixels: Uint8Array, stride: number, width: number, height: number): CassetteReading {
  'worklet';
  const left = analyzeStrip(pixels, stride, width, height, LEFT_STRIP_LEFT, LEFT_STRIP_RIGHT, LEFT_STRIP_SUBSTANCES);
  const right = analyzeStrip(pixels, stride, width, height, RIGHT_STRIP_LEFT, RIGHT_STRIP_RIGHT, RIGHT_STRIP_SUBSTANCES);

  if (left.located && right.located) {
    const topDiff = Math.abs(left.rowTopFrac - right.rowTopFrac);
    const bottomDiff = Math.abs(left.rowBottomFrac - right.rowBottomFrac);
    if (topDiff > ROW_ALIGNMENT_TOLERANCE || bottomDiff > ROW_ALIGNMENT_TOLERANCE) {
      left.located = false;
      right.located = false;
    }
  }

  if (left.located && right.located) {
    const narrower = Math.min(left.colWidthFrac, right.colWidthFrac);
    const wider = Math.max(left.colWidthFrac, right.colWidthFrac);
    const widthRatio = wider > 0 ? narrower / wider : 0;
    if (widthRatio < MIN_WIDTH_CONSISTENCY_RATIO) {
      left.located = false;
      right.located = false;
    }
  }

  if (computeSharpness(pixels, stride, width, height) < MIN_SHARPNESS) {
    left.located = false;
    right.located = false;
  }

  return { leftStrip: left, rightStrip: right };
}

function scoreReading(reading: CassetteReading): number {
  'worklet';
  if (!reading.leftStrip.control.present || !reading.rightStrip.control.present) return -1;
  const locatedBonus = (reading.leftStrip.located ? 0.01 : 0) + (reading.rightStrip.located ? 0.01 : 0);
  return reading.leftStrip.control.confidence + reading.rightStrip.control.confidence + locatedBonus;
}

// Nearest-neighbor crop of a w x h sub-window out of the full luminance buffer, into a tightly
// packed (stride === width) buffer — deliberately re-packed rather than left strided, so every
// downstream index in analyze() can stay simple (`y * width + x`, matching the still-photo
// version's own math) instead of needing the source stride threaded through every call.
function extractRegion(pixels: Uint8Array, srcStride: number, left: number, top: number, w: number, h: number): Uint8Array {
  'worklet';
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const srcStart = (top + y) * srcStride + left;
    for (let x = 0; x < w; x++) {
      out[y * w + x] = pixels[srcStart + x];
    }
  }
  return out;
}

export interface RealtimeAnalysisResult {
  reading: CassetteReading | null;
  matchedScale: number | null;
  bestScore: number;
  /** True when the GLOBAL busyness gate rejected this frame outright before the search even ran
   *  — see MAX_GLOBAL_PEAKS's own doc. Surfaced so the live status text can say something more
   *  useful than a generic "scanning" when the camera is clearly pointed at something busy. */
  tooBusyGlobally: boolean;
  /** Raw gate measurements, always populated regardless of tooBusyGlobally — temporary diagnostic
   *  fields for comparing real live-frame behavior against offline photo testing (see
   *  useCassetteFrameProcessor's own debug logging). Not used for any decision themselves. */
  globalPeaks: number;
  transitionDensity: number;
}

/**
 * Entry point called once per (throttled) frame by the frame processor — see
 * useCassetteFrameProcessor.ts. `pixels` is the Y-plane luminance buffer for the WIDE search crop
 * only (the caller is expected to have already sliced the frame down to
 * CassetteGuideOverlay#computeSearchRectFraction's region before calling this, same as
 * cropAndAnalyze did for the still-photo version), `stride` is that crop's OWN row stride.
 */
export function analyzeSearchCrop(pixels: Uint8Array, stride: number, width: number, height: number): RealtimeAnalysisResult {
  'worklet';
  const globalPeaks = computeGlobalPeaks(pixels, stride, width, height);
  const transitionDensity = computeTransitionDensity(pixels, stride, width, height);
  if (globalPeaks > MAX_GLOBAL_PEAKS || transitionDensity > MAX_TRANSITION_DENSITY) {
    return { reading: null, matchedScale: null, bestScore: -1, tooBusyGlobally: true, globalPeaks, transitionDensity };
  }

  let best: { reading: CassetteReading; scale: number } | null = null;
  let bestScore = -Infinity;

  for (let s = 0; s < SEARCH_SCALES.length; s++) {
    const candWidth = Math.max(1, Math.round(width * SEARCH_SCALES[s]));
    let candHeight = Math.max(1, Math.round(candWidth / GUIDE_ASPECT_RATIO));
    let effectiveCandWidth = candWidth;
    if (candHeight > height) {
      candHeight = height;
      effectiveCandWidth = Math.max(1, Math.round(candHeight * GUIDE_ASPECT_RATIO));
    }
    const candLeft = Math.round((width - effectiveCandWidth) / 2);
    const baseTop = Math.round((height - candHeight) / 2);

    for (let yo = 0; yo < SEARCH_Y_OFFSETS.length; yo++) {
      const candTop = clampNum(baseTop + Math.round(SEARCH_Y_OFFSETS[yo] * height), 0, Math.max(0, height - candHeight));

      const candPixels = extractRegion(pixels, stride, candLeft, candTop, effectiveCandWidth, candHeight);
      const reading = analyze(candPixels, effectiveCandWidth, effectiveCandWidth, candHeight);

      if (SEARCH_SCALES[s] >= LARGE_SCALE_FALLBACK_VETO_THRESHOLD && !reading.leftStrip.located && !reading.rightStrip.located) {
        reading.leftStrip.control = { present: false, confidence: 0 };
        reading.rightStrip.control = { present: false, confidence: 0 };
      }

      const score = scoreReading(reading);
      if (score > bestScore) {
        bestScore = score;
        best = { reading, scale: SEARCH_SCALES[s] };
      }
    }
  }

  return {
    reading: best ? best.reading : null,
    matchedScale: best ? best.scale : null,
    bestScore,
    tooBusyGlobally: false,
    globalPeaks,
    transitionDensity,
  };
}
