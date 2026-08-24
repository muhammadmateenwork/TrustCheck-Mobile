/** Mirrors TestKitInfo.java. */
export interface TestKitInfo {
  partNo: string | null;
  lotNo: string | null;
  expiryDate: number | null; // epoch millis
  /** False when expiryDate's day-of-month is a fabricated placeholder (e.g. a QR code that only
   *  encoded month/year) rather than an actually scanned/selected exact date. */
  expiryDayKnown: boolean;
  scannedFromQr: boolean;
  rawQrData: string | null;
}

/** Valid Dräger DrugCheck part numbers accepted by this app. */
export const VALID_PART_NUMBERS = [
  '3704931',
  '3728699',
  '8325581',
  '3702061',
  '3706089',
  '8327961',
  '3711997',
  '3736377',
] as const;

export function createTestKitInfo(): TestKitInfo {
  return {
    partNo: null,
    lotNo: null,
    expiryDate: null,
    expiryDayKnown: true,
    scannedFromQr: false,
    rawQrData: null,
  };
}

function notEmpty(s: string | null | undefined): boolean {
  return !!s && s.trim().length > 0;
}

export function isTestKitInfoComplete(kit: TestKitInfo): boolean {
  return notEmpty(kit.partNo) && notEmpty(kit.lotNo) && kit.expiryDate != null;
}
