/** Mirrors AlcoholTestInfo.java. */
export interface AlcoholTestInfo {
  deviceSerial: string | null;
  calibrationExpiry: number | null; // epoch millis
  measurementUnit: string | null; // one of MEASUREMENT_UNITS

  firstTestDateTime: number | null; // epoch millis, required
  /** Whether the operator waited 15 minutes before testing. Optional — null until answered. */
  waiting15Min: boolean | null;
  /** Optional confirmatory second test. Must be after firstTestDateTime when set. */
  secondTestDateTime: number | null;
}

export const MEASUREMENT_UNITS = ['µg/L', 'g/210L', '%', 'µg/l', 'g/210l'] as const;

export function createAlcoholTestInfo(): AlcoholTestInfo {
  return {
    deviceSerial: null,
    calibrationExpiry: null,
    measurementUnit: null,
    firstTestDateTime: null,
    waiting15Min: null,
    secondTestDateTime: null,
  };
}

function notEmpty(s: string | null | undefined): boolean {
  return !!s && s.trim().length > 0;
}

export function isAlcoholTestInfoComplete(info: AlcoholTestInfo): boolean {
  return (
    notEmpty(info.deviceSerial) &&
    info.calibrationExpiry != null &&
    notEmpty(info.measurementUnit) &&
    info.firstTestDateTime != null
  );
}

export function hasSecondTest(info: AlcoholTestInfo): boolean {
  return info.secondTestDateTime != null;
}
