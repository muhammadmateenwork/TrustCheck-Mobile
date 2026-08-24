/** Mirrors AlcoholResult.java. */
export interface AlcoholResult {
  firstTestResult: string | null; // ResultValue.NEGATIVE (Pass) / NON_NEGATIVE (Fail)
  /** Only applicable when AlcoholTestInfo has a second test — null otherwise. */
  secondTestResult: string | null;
}

export function createAlcoholResult(): AlcoholResult {
  return { firstTestResult: null, secondTestResult: null };
}

export function isAlcoholResultComplete(result: AlcoholResult): boolean {
  return result.firstTestResult != null;
}
