import { TestKitInfo, VALID_PART_NUMBERS, createTestKitInfo } from '../models/TestKitInfo';
import { endOfMonth } from './dateUtils';

/**
 * Best-effort parser for Dräger DrugCheck test-kit QR codes — mirrors QrCodeParser.java's
 * heuristics exactly (explicit KEY:VALUE pairs first, then pattern matching against the known
 * part number list / LOT format / date format printed on the pouch). The raw scanned text is
 * always kept on the record and every field stays editable after a scan.
 */
const KEY_VALUE = /(REF|PART|P\/N|PN|LOT|CHARGE|BATCH|EXP|EXPIRY)\s*[:=]\s*([^;|\n\r]+)/gi;
const LOT_LIKE = /\b[A-Z]{2,6}-?\d{2,3}[A-Z0-9]*\b/;
const DATE_YYYY_MM_DD = /\b(20\d{2})-(\d{2})-(\d{2})\b/;
const DATE_YYYY_MM = /\b(20\d{2})-(\d{2})\b/;

function toMillis(year: string, month: string, day: string): number | null {
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  const d = parseInt(day, 10);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d, 0, 0, 0, 0);
  // Reject overflowed dates (e.g. Feb 30 rolling into March) the same way
  // SimpleDateFormat's setLenient(false) rejects them.
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date.getTime();
}

function parseDate(text: string): number | null {
  const full = DATE_YYYY_MM_DD.exec(text);
  if (full) return toMillis(full[1], full[2], full[3]);
  const yearMonth = DATE_YYYY_MM.exec(text);
  if (yearMonth) return toMillis(yearMonth[1], yearMonth[2], '01');
  return null;
}

export function parseQrCode(rawText: string | null): TestKitInfo {
  const info = createTestKitInfo();
  info.rawQrData = rawText;
  info.scannedFromQr = true;
  if (!rawText || rawText.trim() === '') return info;

  let match: RegExpExecArray | null;
  KEY_VALUE.lastIndex = 0;
  while ((match = KEY_VALUE.exec(rawText)) !== null) {
    const key = match[1].toUpperCase();
    const value = match[2].trim();
    if (key === 'REF' || key === 'PART' || key === 'P/N' || key === 'PN') {
      info.partNo = value;
    } else if (key === 'LOT' || key === 'CHARGE' || key === 'BATCH') {
      info.lotNo = value;
    } else if (key === 'EXP' || key === 'EXPIRY') {
      info.expiryDate = parseDate(value);
      // parseDate() falls back to fabricating day "01" when only a month/year is present (no
      // DATE_YYYY_MM_DD match) — same situation the fallback pattern-matching path below already
      // flags via expiryDayKnown=false, so this explicit key:value path needs the same flag or a
      // kit printed with "EXP:2026-08" silently shows a fake exact day instead of "Aug 2026".
      info.expiryDayKnown = DATE_YYYY_MM_DD.test(value);
    }
  }

  if (!info.partNo) {
    for (const candidate of VALID_PART_NUMBERS) {
      if (rawText.includes(candidate)) {
        info.partNo = candidate;
        break;
      }
    }
  }

  if (!info.lotNo) {
    const lotMatch = LOT_LIKE.exec(rawText);
    if (lotMatch) info.lotNo = lotMatch[0];
  }

  if (info.expiryDate == null) {
    const fullDate = DATE_YYYY_MM_DD.exec(rawText);
    if (fullDate) {
      info.expiryDate = toMillis(fullDate[1], fullDate[2], fullDate[3]);
      info.expiryDayKnown = true;
    } else {
      const monthYear = DATE_YYYY_MM.exec(rawText);
      if (monthYear) {
        // The QR only encodes a month/year, not an exact day — don't invent one. Keep the date
        // at end-of-month so "is this expired" checks stay correct, but flag the day as unknown
        // so the UI only ever displays "MMM yyyy", never a fake day.
        const monthStart = toMillis(monthYear[1], monthYear[2], '01');
        if (monthStart != null) {
          info.expiryDate = endOfMonth(monthStart);
          info.expiryDayKnown = false;
        }
      }
    }
  }

  return info;
}
