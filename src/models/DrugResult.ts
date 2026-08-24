import { ResultValue } from './ResultValue';

/** "C" isn't a drug — it's the cassette's Control line, printed once per strip purely as a
 *  validity check. Kept in SUBSTANCES because the record's saved shape, the PDF, and the detail
 *  view all iterate it generically and expect an entry for it; the Drug Result screen excludes
 *  it from the operator-facing rows and always records it as Negative. */
export const CONTROL_LINE_KEY = 'C';

/** Substance panel shown only when the overall result is non-negative. */
export const SUBSTANCES = [CONTROL_LINE_KEY, 'MET', 'AMP', 'THC', 'OPI', 'OXY', 'COC'] as const;

/** Mirrors DrugResult.java. */
export interface DrugResult {
  overallResult: string | null; // ResultValue.NEGATIVE / NON_NEGATIVE
  substanceResults: Record<string, string>;

  /** Operator's signature confirming the result matches their visual inspection, captured via
   *  the Result Confirmation popup before this screen allows moving on. */
  confirmationSignaturePath: string | null;

  /** True while overallResult/substanceResults still reflect the camera's auto-read of the
   *  cassette photo rather than anything the operator has manually changed — drives the
   *  "auto-detected, please verify" banner. Cleared the moment the operator touches any radio
   *  button, whether or not they end up agreeing with it. */
  autoDetected: boolean;
}

export function createDrugResult(): DrugResult {
  return {
    overallResult: null,
    substanceResults: {},
    confirmationSignaturePath: null,
    autoDetected: false,
  };
}

function notEmpty(s: string | null | undefined): boolean {
  return !!s && s.trim().length > 0;
}

export function isDrugResultComplete(result: DrugResult): boolean {
  if (result.overallResult == null) return false;
  if (!notEmpty(result.confirmationSignaturePath)) return false;
  if (result.overallResult === ResultValue.NEGATIVE) return true;
  return SUBSTANCES.every((substance) => substance in result.substanceResults);
}
