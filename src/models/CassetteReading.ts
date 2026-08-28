import { DrugResult } from './DrugResult';
import { ResultValue } from './ResultValue';
import { LEFT_STRIP_SUBSTANCES, RIGHT_STRIP_SUBSTANCES } from './CassetteTemplate';

/** Mirrors CassetteAnalyzer.java's result types — see cassetteAnalyzerScript.ts for where these
 *  are actually produced (inside the WebView-hosted pixel analysis). */
export interface LineReading {
  present: boolean;
  /** 0 (borderline, right at the threshold) - 1 (unambiguous). */
  confidence: number;
}

export interface StripReading {
  control: LineReading;
  substances: Record<string, LineReading>;
  /** Whether this strip's membrane window was actually located by the lightness-based search
   *  (see realtimeCassetteAnalyzer.ts#analyzeStrip), as opposed to falling back to a fixed template
   *  fraction because nothing distinct stood out. See isConfidentlyDetected's own doc for why
   *  this matters. */
  located: boolean;
}

export interface CassetteReading {
  leftStrip: StripReading;
  rightStrip: StripReading;
}

export function isLeftValid(reading: CassetteReading): boolean {
  return reading.leftStrip.control.present;
}

export function isRightValid(reading: CassetteReading): boolean {
  return reading.rightStrip.control.present;
}

/** Both strips' control lines have to actually show up for the reading to be trusted enough to
 *  auto-fill anything — matches the native app's own deliberately conservative bar (see
 *  CassetteReading.java#isFullyValid's own doc: validity is technically per-strip per the
 *  official IFU, but this app only ever auto-suggests a result when there's nothing left for the
 *  operator to double-check). */
export function isFullyValid(reading: CassetteReading): boolean {
  return isLeftValid(reading) && isRightValid(reading);
}

/** How confident a strip's CONTROL line call has to be (0 = right at the threshold, a coin flip;
 *  1 = unambiguous) before an auto-scan capture is trusted, WHEN that strip's membrane window was
 *  genuinely located by the search (StripReading#located) — see isConfidentlyDetected for why
 *  only the control lines are gated on confidence, not every substance line too. */
const MIN_CONTROL_CONFIDENCE_LOCATED = 0.3;

/** The much higher bar applied instead when a strip's search DIDN'T locate a real membrane
 *  window and fell back to the fixed template position — see isConfidentlyDetected's own doc for
 *  why the fallback path needs a stricter confidence requirement to stay safe against false
 *  positives, now that a low-confidence fallback reading is no longer rejected outright. */
const MIN_CONTROL_CONFIDENCE_FALLBACK = 0.75;

/**
 * The real gate the background auto-scan loop (DrugCassetteScanScreen) uses to decide "this is
 * an actual cassette reading, fill it in" — stricter than isFullyValid() alone, which only checks
 * that both strips' control lines read as present. isFullyValid() is a purely relative contrast
 * check within each strip's ASSUMED line positions; when the strip-location search below it comes
 * up empty (nothing distinctly lighter than its surroundings — i.e. the search couldn't find a
 * real membrane), both native and this port silently fall back to guessing the strip sits at the
 * template's fixed fraction of the frame and score contrast peaks there regardless.
 *
 * An earlier version of this function rejected the fallback path outright (required
 * StripReading#located on both strips, unconditionally) — added after this port's continuous
 * auto-scan retry loop (which native never had; it only ever risks one single analysis per
 * deliberate manual tap) turned out to occasionally read a false "detection" out of random
 * household scenes. But testing against real reference photos of the physical Dräger cassette
 * (via a Node test harness running this exact algorithm, offline) showed that requirement
 * throwing away GENUINE reads too: several real cassette photos had strong, clear line contrast
 * at the assumed positions (control confidence well above the located-path bar) even though the
 * coarse column/row search failed to find the membrane cleanly — bad lighting or a background too
 * close in tone to the strip, not the absence of a cassette. Outright rejecting every fallback
 * reading meant those real photos could never be detected no matter how clear the actual lines
 * were.
 *
 * The fix: still accept a fallback (unlocated) reading, but only when its control-line confidence
 * clears a MUCH higher bar (MIN_CONTROL_CONFIDENCE_FALLBACK) than a genuinely-located one needs
 * (MIN_CONTROL_CONFIDENCE_LOCATED) — getting BOTH strips' control lines to independently show
 * strong, unambiguous contrast at their exact expected positions, with no geometric confirmation
 * that a real membrane is even there, is still implausible for random non-cassette content to
 * produce by chance, while a real cassette with strong printed lines clears it easily.
 *
 * Confidence is only required on the CONTROL lines, not every substance line: per the Dräger
 * DrugCheck 3000 IFU (section 4.2), a weak, partially colored, or broken substance test line
 * still reads as a valid negative result — a faint-but-real substance line is expected, normal,
 * and should still auto-fill (the operator reviews and can correct every field on the next
 * screen regardless). The control line is different: it's the assay's own built-in quality
 * check, expected to print consistently and clearly when the test ran correctly at all, so
 * requiring a real confidence margin specifically there — on top of it already having to read as
 * present — is a meaningful "this really is a cassette, not noise" signal without punishing
 * genuinely faint (but valid) drug-panel results.
 */
export function isConfidentlyDetected(reading: CassetteReading): boolean {
  const leftBar = reading.leftStrip.located ? MIN_CONTROL_CONFIDENCE_LOCATED : MIN_CONTROL_CONFIDENCE_FALLBACK;
  const rightBar = reading.rightStrip.located ? MIN_CONTROL_CONFIDENCE_LOCATED : MIN_CONTROL_CONFIDENCE_FALLBACK;
  return (
    isFullyValid(reading) &&
    reading.leftStrip.control.confidence >= leftBar &&
    reading.rightStrip.control.confidence >= rightBar
  );
}

export function minConfidence(reading: CassetteReading): number {
  let min = 1;
  min = Math.min(min, reading.leftStrip.control.confidence);
  min = Math.min(min, reading.rightStrip.control.confidence);
  for (const key of Object.keys(reading.leftStrip.substances)) {
    min = Math.min(min, reading.leftStrip.substances[key].confidence);
  }
  for (const key of Object.keys(reading.rightStrip.substances)) {
    min = Math.min(min, reading.rightStrip.substances[key].confidence);
  }
  return min;
}

function putResult(into: Record<string, string>, substance: string, reading: LineReading): boolean {
  const negative = reading.present;
  into[substance] = negative ? ResultValue.NEGATIVE : ResultValue.NON_NEGATIVE;
  return !negative;
}

/** Maps a reading onto a DrugResult exactly the way a manual read would fill it in: a visible
 *  test line is Negative for that substance, a missing/faint one is Non-Negative. Mirrors
 *  CassetteReading.java#applyTo. Callers must check isFullyValid() first. */
export function applyReadingTo(reading: CassetteReading, result: DrugResult): void {
  const substances: Record<string, string> = {};
  let anyNonNegative = false;
  for (const key of Object.keys(reading.leftStrip.substances)) {
    anyNonNegative = putResult(substances, key, reading.leftStrip.substances[key]) || anyNonNegative;
  }
  for (const key of Object.keys(reading.rightStrip.substances)) {
    anyNonNegative = putResult(substances, key, reading.rightStrip.substances[key]) || anyNonNegative;
  }
  substances['C'] = ResultValue.NEGATIVE;

  result.overallResult = anyNonNegative ? ResultValue.NON_NEGATIVE : ResultValue.NEGATIVE;
  result.substanceResults = {};
  if (anyNonNegative) {
    result.substanceResults = substances;
  }
}

export const SUBSTANCES_BY_STRIP = { left: LEFT_STRIP_SUBSTANCES, right: RIGHT_STRIP_SUBSTANCES };
