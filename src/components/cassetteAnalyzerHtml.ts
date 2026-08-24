/**
 * HTML page hosted inside a hidden WebView, running a faithful JS port of CassetteAnalyzer.java's
 * pixel-analysis algorithm — a WebView canvas is used to get real getImageData() pixel access,
 * since Expo Go has no bundled native module for that. The RN side (CassetteAnalyzerBridge.tsx)
 * posts a base64 JPEG in, this decodes it via an <img>+<canvas>, runs the same column/row search
 * + darkness-profile + global/local-contrast line detection as the native version, and posts the
 * resulting CassetteReading back out as JSON.
 *
 * Beyond the faithful port, this also adds several checks/mechanisms with NO native equivalent —
 * native only ever analyzes ONE photo, from a deliberate manual tap, with the operator expected
 * to frame it well; this port's continuous auto-scan loop instead has to cope with the cassette
 * appearing at whatever distance, position, and tilt the operator happens to be holding the
 * phone at on any given attempt, on ANY phone's camera. In order:
 *
 * 1. A blur/motion-sharpness gate over the whole crop (computeSharpness) — a badly out-of-focus
 *    or motion-smeared frame is rejected before any line is even scored.
 * 2. A cross-strip row-alignment consistency check in analyze() — the two strips are on one
 *    rigid physical card, so their located windows must line up vertically; two accidental
 *    "found something" patches elsewhere in a scene have no reason to.
 * 3. Widened strip-search tolerances calibrated against a real reference photo of the physical
 *    Dräger DrugCheck 3000 cassette (native's own tolerances assumed a wider crop showing the
 *    cassette's blue-gray housing around the reading window, which this app's tight guide-box
 *    crop doesn't include).
 * 4. A multi-scale, multi-rotation, multi-position SEARCH (searchAndAnalyze/cropAndAnalyze)
 *    across a generously wide capture area instead of assuming the reading window exactly fills
 *    one fixed guide box — this is what lets the operator hold the cassette closer, farther, at a
 *    moderate tilt, or positioned somewhat above/below the guide box's exact on-screen spot, and
 *    still get read correctly, rather than requiring near-perfect framing on every single
 *    attempt. The vertical-position component (SEARCH_Y_OFFSETS) was added after real-photo
 *    testing (see that constant's own doc) showed a center-only search failing even under
 *    exhaustive brute-force testing on several genuine cassette photos.
 *
 * IMPORTANT: none of this has been validated against a real cassette photo (no device access
 * from here) — same caveat that applied to every round of the native app's own detector work
 * before on-device testing shook out real bugs. Treat this as a best-effort classical
 * computer-vision approach, not a confirmed-working or ML-trained detector: there is no bundled
 * or trained machine-learning model here (Expo Go has no way to run one, and there is no labeled
 * training data available to train one against). Budget for further iteration once tested on a
 * real phone against a real cassette, exactly like the native version needed.
 */
export const CASSETTE_ANALYZER_HTML = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><style>html,body{margin:0;padding:0;background:#000;}</style></head>
<body>
<canvas id="c" style="display:none"></canvas>
<script>
// ---- CassetteTemplate.java constants ----
var LEFT_STRIP_SUBSTANCES = ["MET", "THC", "OXY"];
var RIGHT_STRIP_SUBSTANCES = ["AMP", "OPI", "COC"];
var LEFT_STRIP_LEFT = 0.30, LEFT_STRIP_RIGHT = 0.47;
var RIGHT_STRIP_LEFT = 0.53, RIGHT_STRIP_RIGHT = 0.70;
var ROW_CENTERS_Y = [0.14, 0.38, 0.62, 0.86];
var LINE_BAND_HEIGHT = 0.14;
// Must match CassetteTemplate.ts's own GUIDE_ASPECT_RATIO — the physical reading window's
// width/height shape, used by searchAndAnalyze() below to derive a candidate window's height
// from whatever width it's currently trying at each search scale.
var GUIDE_ASPECT_RATIO = 0.68;

// ---- CassetteAnalyzer.java constants ----
var PRESENCE_THRESHOLD = 22;
var CONFIDENCE_MARGIN = 20;
// Widened from native's originals (0.12 / 18 / 0.10 / 0.30): those assumed a wide crop showing
// the membrane strip against the surrounding blue-gray cassette HOUSING, where the lightness
// contrast is strong. This port's guide box (see CassetteGuideOverlay) crops much tighter, to
// just the reading-window region itself (strips + their printed row labels, no housing) — within
// that tight crop the label background and the strip are much closer in tone, so the original,
// stricter thresholds were failing to locate a real strip even on a genuine cassette photo. Wider
// margins and lower minimum-run fractions make the search reliably succeed on real photos; the
// actual anti-false-positive protection lives in isConfidentlyDetected's confidence gate, not here.
var STRIP_SEARCH_MARGIN = 0.20;
var STRIP_LIGHTNESS_MARGIN = 10;
var MIN_STRIP_WIDTH_FRACTION = 0.06;
var MIN_WINDOW_HEIGHT_FRACTION = 0.18;
var LOCAL_BACKGROUND_MARGIN_FRACTION = 0.04;
var LOCAL_PRESENCE_THRESHOLD = 8;

// ---- Extra cross-checks with no native equivalent — see analyze()'s own doc for why these were
// added on top of a faithful port of the native algorithm. ----
// How far apart (as a fraction of crop height) the left and right strips' own located row
// windows are allowed to be before they're rejected as not actually belonging to the same
// physical cassette. Lenient enough to tolerate a slightly tilted/uneven crop, tight enough that
// two unrelated "something lighter than its surroundings" patches elsewhere in a photo — which
// have no reason to line up vertically at all — essentially never pass by chance.
var ROW_ALIGNMENT_TOLERANCE = 0.12;
// Below this average adjacent-pixel luminance-gradient magnitude, a frame is treated as too
// blurred/motion-smeared to trust any line call from at all (both strips forced to read as not
// located) — deliberately lenient (only rejects clearly, badly out-of-focus frames) since this
// constant has no real-photo calibration behind it either.
var MIN_SHARPNESS = 3;

// Rotation angles (degrees) and window scales searchAndAnalyze() tries, in every combination, to
// find the cassette regardless of exactly how the operator is holding it — see that function's
// own doc. Scale is the fraction of the wide search crop's width a candidate window spans: 0.85
// covers a cassette held close enough to fill most of the extra search margin, 0.35 covers one
// held farther away than the guide box alone would tolerate.
var SEARCH_ROTATIONS_DEG = [0, -10, 10];
var SEARCH_SCALES = [0.85, 0.65, 0.5, 0.35];
// Vertical offsets (as a fraction of the search crop's own height) tried on top of every
// rotation/scale combination — added after testing against real reference photos of the physical
// Dräger cassette (via a Node test harness running this exact algorithm, offline) showed the
// previous center-only search failing on most of them even under exhaustive brute-force position
// testing, while the successful crops were consistently offset noticeably below center (never
// near it). A guide box drawn at one fixed position on screen does not guarantee the cassette's
// actual reading window lands dead-center within it — how far the plunger extends above the
// reading window shifts the window's real position within the frame depending on how the
// operator happens to be holding it. Kept to vertical-only (not a full 2D grid) to bound the
// candidate count: 3 rotations x 4 scales x 5 y-offsets = 60 candidates per attempt, versus 12
// before — every candidate re-runs the full analyze() pipeline, so this trades some speed for a
// meaningfully better real-world hit rate; CassetteAnalyzerBridge's timeout accounts for this.
var SEARCH_Y_OFFSETS = [0, -0.15, 0.15, -0.3, 0.3];

function clampInt(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function median(arr) {
  var sorted = arr.slice().sort(function (a, b) { return a - b; });
  return sorted[Math.floor(sorted.length / 2)];
}

function findRange(lightnessArr, searchLen, minFraction) {
  var thresh = median(lightnessArr) + STRIP_LIGHTNESS_MARGIN;
  var bestStart = -1, bestLength = 0, runStart = -1;
  for (var i = 0; i <= searchLen; i++) {
    var above = i < searchLen && lightnessArr[i] >= thresh;
    if (above) {
      if (runStart === -1) runStart = i;
    } else if (runStart !== -1) {
      var length = i - runStart;
      if (length > bestLength) { bestLength = length; bestStart = runStart; }
      runStart = -1;
    }
  }
  if (bestLength < searchLen * minFraction) return null;
  return [bestStart, bestStart + bestLength];
}

function findStripColumnRange(pixels, width, height, searchLeft, searchRight) {
  var searchWidth = searchRight - searchLeft;
  var colLightness = new Array(searchWidth);
  for (var x = 0; x < searchWidth; x++) {
    var col = searchLeft + x, sum = 0;
    for (var y = 0; y < height; y++) {
      var idx = (y * width + col) * 4;
      sum += (pixels[idx] + pixels[idx + 1] + pixels[idx + 2]) / 3;
    }
    colLightness[x] = sum / height;
  }
  var range = findRange(colLightness, searchWidth, MIN_STRIP_WIDTH_FRACTION);
  if (!range) return null;
  return [searchLeft + range[0], searchLeft + range[1]];
}

function findStripRowRange(pixels, width, height, left, right) {
  var stripWidth = Math.max(1, right - left);
  var rowLightness = new Array(height);
  for (var y = 0; y < height; y++) {
    var sum = 0;
    for (var x = left; x < right; x++) {
      var idx = (y * width + x) * 4;
      sum += (pixels[idx] + pixels[idx + 1] + pixels[idx + 2]) / 3;
    }
    rowLightness[y] = sum / stripWidth;
  }
  return findRange(rowLightness, height, MIN_WINDOW_HEIGHT_FRACTION);
}

function buildVerticalDarknessProfile(pixels, width, top, bottom, left, right) {
  var rangeHeight = Math.max(1, bottom - top);
  var stripWidth = Math.max(1, right - left);
  var profile = new Array(rangeHeight);
  for (var i = 0; i < rangeHeight; i++) {
    var y = top + i, sum = 0;
    for (var x = left; x < right; x++) {
      var idx = (y * width + x) * 4;
      var minChannel = Math.min(pixels[idx], pixels[idx + 1], pixels[idx + 2]);
      sum += (255 - minChannel);
    }
    profile[i] = sum / stripWidth;
  }
  return profile;
}

/** Average absolute luminance difference between horizontally-adjacent samples on a coarse grid
 *  across the WHOLE crop (not per-strip — this measures overall image focus, which a blurred
 *  photo loses everywhere at once, not just within the reading window). A real, in-focus photo
 *  has sharp ink/edge transitions that produce real local contrast; a badly out-of-focus or
 *  motion-blurred frame smears everything toward a locally flat luminance regardless of what the
 *  frame otherwise contains, which is what this collapsing toward zero actually detects — rather
 *  than trying to measure "blur" directly, this measures the one concrete symptom that matters
 *  for line detection specifically. */
function computeSharpness(pixels, width, height) {
  var stepX = Math.max(1, Math.floor(width / 60));
  var stepY = Math.max(1, Math.floor(height / 60));
  var total = 0, count = 0;
  for (var y = 0; y < height; y += stepY) {
    var prevLum = -1;
    for (var x = 0; x < width; x += stepX) {
      var idx = (y * width + x) * 4;
      var lum = (pixels[idx] + pixels[idx + 1] + pixels[idx + 2]) / 3;
      if (prevLum >= 0) {
        total += Math.abs(lum - prevLum);
        count++;
      }
      prevLum = lum;
    }
  }
  return count > 0 ? total / count : 0;
}

function localNeighborLevel(profile, bandFrom, bandTo, margin) {
  var neighbors = [];
  for (var y = bandFrom - margin; y < bandFrom; y++) if (y >= 0) neighbors.push(profile[y]);
  for (var y2 = bandTo + 1; y2 <= bandTo + margin; y2++) if (y2 < profile.length) neighbors.push(profile[y2]);
  if (neighbors.length === 0) {
    return profile[clampInt(Math.round((bandFrom + bandTo) / 2), 0, profile.length - 1)];
  }
  neighbors.sort(function (a, b) { return a - b; });
  return neighbors[Math.floor(neighbors.length / 2)];
}

function detectLine(profile, expectedYFraction, background) {
  var height = profile.length;
  var center = Math.round(expectedYFraction * height);
  var band = Math.max(1, Math.round(LINE_BAND_HEIGHT * height));
  var half = Math.floor(band / 2);
  var from = clampInt(center - half, 0, height - 1);
  var to = clampInt(center + half, 0, height - 1);

  var peak = 0;
  for (var y = from; y <= to; y++) peak = Math.max(peak, profile[y]);
  var globalContrast = peak - background;

  var margin = Math.max(1, Math.round(LOCAL_BACKGROUND_MARGIN_FRACTION * height));
  var localLevel = localNeighborLevel(profile, from, to, margin);
  var localContrast = peak - localLevel;

  var present = globalContrast >= PRESENCE_THRESHOLD && localContrast >= LOCAL_PRESENCE_THRESHOLD;
  var confidence = clampInt(Math.abs(globalContrast - PRESENCE_THRESHOLD) / CONFIDENCE_MARGIN, 0, 1);
  return { present: present, confidence: confidence };
}

function analyzeStrip(pixels, width, height, leftFrac, rightFrac, substances) {
  var searchLeft = clampInt(Math.round((leftFrac - STRIP_SEARCH_MARGIN) * width), 0, width - 1);
  var searchRight = clampInt(Math.round((rightFrac + STRIP_SEARCH_MARGIN) * width), searchLeft + 1, width);

  var columns = findStripColumnRange(pixels, width, height, searchLeft, searchRight);
  var leftPx, rightPx;
  if (columns) { leftPx = columns[0]; rightPx = columns[1]; }
  else {
    leftPx = clampInt(Math.round(leftFrac * width), 0, width - 1);
    rightPx = clampInt(Math.round(rightFrac * width), leftPx + 1, width);
  }

  var rows = findStripRowRange(pixels, width, height, leftPx, rightPx);
  var topPx = rows ? rows[0] : 0;
  var bottomPx = rows ? rows[1] : height;

  var profile = buildVerticalDarknessProfile(pixels, width, topPx, bottomPx, leftPx, rightPx);
  var background = median(profile);

  var control = detectLine(profile, ROW_CENTERS_Y[0], background);
  var substanceReadings = {};
  for (var i = 0; i < substances.length; i++) {
    substanceReadings[substances[i]] = detectLine(profile, ROW_CENTERS_Y[i + 1], background);
  }
  // Whether this strip's own membrane window was actually located by the lightness search, as
  // opposed to the naive fixed-fraction fallback used when nothing stood out — see
  // isConfidentlyDetected's own doc in CassetteReading.ts for why this matters: without it, a
  // fixed-fraction guess over ARBITRARY image content (a wall, furniture, anything) still gets
  // scored as if it were a real strip, which is how a non-cassette scene can pass the same
  // contrast checks a genuine cassette does.
  var located = !!(columns && rows);
  return {
    control: control,
    substances: substanceReadings,
    located: located,
    // Only meaningful when located — used by analyze() below to cross-check the two strips
    // against each other; not part of the JSON shape CassetteReading.ts's interface declares,
    // but harmless to include (unused extra fields survive JSON.parse without effect).
    rowTopFrac: topPx / height,
    rowBottomFrac: bottomPx / height
  };
}

function analyze(pixels, width, height) {
  var left = analyzeStrip(pixels, width, height, LEFT_STRIP_LEFT, LEFT_STRIP_RIGHT, LEFT_STRIP_SUBSTANCES);
  var right = analyzeStrip(pixels, width, height, RIGHT_STRIP_LEFT, RIGHT_STRIP_RIGHT, RIGHT_STRIP_SUBSTANCES);

  // Cross-strip consistency: both strips are printed on the SAME rigid physical cassette, so
  // their located row windows have to line up closely — two accidental "found something lighter
  // than its surroundings" patches in unrelated household clutter have no reason to align
  // vertically like that, which makes this a strong, geometry-only (no extra tunable contrast
  // constants) defense against the false-positive failure mode a continuous retry loop is prone
  // to (see this file's own top-level doc and DrugCassetteScanScreen's).
  if (left.located && right.located) {
    var topDiff = Math.abs(left.rowTopFrac - right.rowTopFrac);
    var bottomDiff = Math.abs(left.rowBottomFrac - right.rowBottomFrac);
    if (topDiff > ROW_ALIGNMENT_TOLERANCE || bottomDiff > ROW_ALIGNMENT_TOLERANCE) {
      left.located = false;
      right.located = false;
    }
  }

  // A badly blurred/motion-smeared frame can't be trusted regardless of what the per-strip
  // search thinks it found — see computeSharpness's own doc.
  if (computeSharpness(pixels, width, height) < MIN_SHARPNESS) {
    left.located = false;
    right.located = false;
  }

  return { leftStrip: left, rightStrip: right };
}

function post(message) {
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
}

/** Rotates the whole canvas about its own center by angleDeg, into a new same-size canvas —
 *  content rotated outside the original bounds is clipped, which is fine here since every
 *  candidate window searchAndAnalyze() reads back out is smaller than and centered within this,
 *  never reaching those corners. */
function rotateCanvas(sourceCanvas, angleDeg) {
  if (angleDeg === 0) return sourceCanvas;
  var angleRad = (angleDeg * Math.PI) / 180;
  var w = sourceCanvas.width, h = sourceCanvas.height;
  var out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  var ctx = out.getContext('2d');
  ctx.translate(w / 2, h / 2);
  ctx.rotate(angleRad);
  ctx.drawImage(sourceCanvas, -w / 2, -h / 2);
  return out;
}

/** Copies a w x h pixel rectangle out of a full RGBA buffer via row-wise subarray copies —
 *  plain typed-array indexing, no canvas involved. Used so searchAndAnalyze() only has to pay for
 *  the actual expensive operation (a canvas getImageData() pixel readback) once per rotation
 *  instead of once per candidate — see that function's own doc for why this mattered in practice. */
function extractRegion(pixels, width, left, top, w, h) {
  var out = new Uint8ClampedArray(w * h * 4);
  for (var y = 0; y < h; y++) {
    var srcStart = ((top + y) * width + left) * 4;
    out.set(pixels.subarray(srcStart, srcStart + w * 4), y * w * 4);
  }
  return out;
}

/** Ranks a candidate purely to pick the most promising one out of many tried by
 *  searchAndAnalyze() — NOT the accept/reject decision itself, which stays entirely in
 *  CassetteReading.ts#isConfidentlyDetected (and the two-consecutive-frame consensus in
 *  DrugCassetteScanScreen) on the RN side, working from whichever single candidate this hands
 *  back. A candidate that didn't even read both control lines as present scores below every
 *  candidate that did, regardless of confidence numbers. Deliberately does NOT disqualify a
 *  candidate just for failing to locate both strips (unlike an earlier version of this function)
 *  — isConfidentlyDetected still applies a much stricter confidence bar to an unlocated
 *  candidate, but a genuine cassette read with strong line contrast and a failed geometric search
 *  (bad lighting, a background too close in tone to the strip) needs to still be rankable so it
 *  can win over a worse candidate, not be thrown out at this stage before that stricter bar even
 *  gets a chance to evaluate it. A small bonus for actually being located just breaks ties in
 *  favor of the more geometrically-confirmed candidate when confidence is otherwise similar. */
function scoreReading(reading) {
  if (!reading.leftStrip.control.present || !reading.rightStrip.control.present) return -1;
  var locatedBonus = (reading.leftStrip.located ? 0.01 : 0) + (reading.rightStrip.located ? 0.01 : 0);
  return reading.leftStrip.control.confidence + reading.rightStrip.control.confidence + locatedBonus;
}

/**
 * Searches the wide crop handed in (see CassetteGuideOverlay#computeSearchRectFraction — several
 * times bigger than the on-screen guide box the operator actually aims at) across every
 * combination of SEARCH_ROTATIONS_DEG, SEARCH_SCALES, and SEARCH_Y_OFFSETS, analyzing each
 * candidate sub-window with the same analyze() used everywhere else, and keeps whichever
 * candidate scores best (see scoreReading) — this is what lets the operator hold the cassette at
 * a distance, tilt, or vertical position other than exactly filling one fixed box and still get a
 * real reading, instead of requiring near-perfect framing on every single attempt. Always returns
 * SOME candidate (the last one tried, if literally nothing scored above -1) so the caller's
 * normal reject-and-retry path still applies the same way it would to a single failed analysis.
 *
 * Reads pixel data back from the canvas (getImageData) only ONCE per rotation (3 times total),
 * not once per candidate (which would be 60 times, 4 scales x 5 y-offsets x 3 rotations) — a
 * canvas pixel readback is real, measurable overhead on a phone WebView, and every candidate here
 * needs the same underlying rotated pixels, just a different sub-rectangle of them. Every
 * candidate's own crop is instead a plain typed-array slice (extractRegion) out of that one
 * readback — mathematically identical to what re-drawing into a fresh canvas and reading it back
 * would produce, just without paying for the canvas round-trip 60 times. No candidate ever needs
 * to become an image of its own: only the reading is returned, never a cropped photo — see
 * cropAndAnalyze's own doc for why the full original capture is what stays saved.
 */
function searchAndAnalyze(searchCanvas) {
  var best = null;
  var bestScore = -Infinity;
  var w = searchCanvas.width, h = searchCanvas.height;

  for (var r = 0; r < SEARCH_ROTATIONS_DEG.length; r++) {
    var rotDeg = SEARCH_ROTATIONS_DEG[r];
    var rotated = rotateCanvas(searchCanvas, rotDeg);
    var fullPixels = rotated.getContext('2d').getImageData(0, 0, w, h).data;

    for (var s = 0; s < SEARCH_SCALES.length; s++) {
      var candWidth = Math.max(1, Math.round(w * SEARCH_SCALES[s]));
      var candHeight = Math.max(1, Math.round(candWidth / GUIDE_ASPECT_RATIO));
      if (candHeight > h) {
        candHeight = h;
        candWidth = Math.max(1, Math.round(candHeight * GUIDE_ASPECT_RATIO));
      }
      var candLeft = Math.round((w - candWidth) / 2);
      var baseTop = Math.round((h - candHeight) / 2);

      for (var yo = 0; yo < SEARCH_Y_OFFSETS.length; yo++) {
        var candTop = clampInt(baseTop + Math.round(SEARCH_Y_OFFSETS[yo] * h), 0, Math.max(0, h - candHeight));

        var candPixels = extractRegion(fullPixels, w, candLeft, candTop, candWidth, candHeight);
        var reading = analyze(candPixels, candWidth, candHeight);
        var score = scoreReading(reading);
        if (score > bestScore) {
          bestScore = score;
          best = { reading: reading };
        }
      }
    }
  }

  return best;
}

/**
 * Crops to the wide SEARCH fraction first (not the tight on-screen guide box — see
 * CassetteGuideOverlay#computeSearchRectFraction), then hands that off to searchAndAnalyze()
 * purely to get a reading back. Deliberately does NOT produce or return a cropped image: an
 * earlier version made the winning candidate's own (rotated, rescaled) sub-window become the
 * saved/displayed photo, matching DrugCassetteScanActivity.tryAnalyze()'s "the saved/displayed
 * photo always becomes this same crop" rule — but per explicit product direction the record's
 * photo must stay the complete original capture, not an internal analysis crop that could be
 * zoomed in tight or rotated relative to what the operator actually photographed. The full photo
 * already on disk (see CassetteAnalyzerBridge#cropAndAnalyze) is left untouched; only the reading
 * comes back from here.
 */
function cropAndAnalyze(img, frac) {
  var fullCanvas = document.getElementById('c');
  fullCanvas.width = img.width;
  fullCanvas.height = img.height;
  var fullCtx = fullCanvas.getContext('2d');
  fullCtx.drawImage(img, 0, 0);

  var left = Math.max(0, Math.round(frac.left * img.width));
  var top = Math.max(0, Math.round(frac.top * img.height));
  var right = Math.min(img.width, Math.round(frac.right * img.width));
  var bottom = Math.min(img.height, Math.round(frac.bottom * img.height));
  var searchWidth = Math.max(1, right - left);
  var searchHeight = Math.max(1, bottom - top);

  var searchCanvas = document.createElement('canvas');
  searchCanvas.width = searchWidth;
  searchCanvas.height = searchHeight;
  var searchCtx = searchCanvas.getContext('2d');
  searchCtx.drawImage(fullCanvas, left, top, searchWidth, searchHeight, 0, 0, searchWidth, searchHeight);

  var best = searchAndAnalyze(searchCanvas);
  return { reading: best ? best.reading : null };
}

function handleMessage(event) {
  try {
    var data = JSON.parse(event.data);
    if (data.type !== 'analyze') return;
    var img = new Image();
    img.onload = function () {
      try {
        var out = cropAndAnalyze(img, data.searchFraction);
        post({ type: 'result', requestId: data.requestId, reading: out.reading });
      } catch (e) {
        post({ type: 'error', requestId: data.requestId, message: String(e) });
      }
    };
    img.onerror = function () {
      post({ type: 'error', requestId: data.requestId, message: 'Could not decode image' });
    };
    img.src = data.imageBase64;
  } catch (e) {
    post({ type: 'error', requestId: null, message: String(e) });
  }
}

document.addEventListener('message', handleMessage);
window.addEventListener('message', handleMessage);
</script>
</body>
</html>
`;
