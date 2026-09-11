import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ExcelJS from 'exceljs';
import { ReasonCount } from './cloudSync';
import { DOWNLOADS_DIR_URI_KEY } from './reportExport';

/** One row per applied filter (e.g. "Date range" -> "1 Jan 2026 to 7 Jan 2026", "Reason" ->
 *  "Random"), shown at the top of the sheet above the counts table so the exported file is
 *  self-describing on its own, without needing the app open to know what it's a count of. */
export interface SummaryFilterRow {
  label: string;
  value: string;
}

const HEADER_FILL = 'FF1F4E5F';
const HEADER_FONT_ARGB = 'FFFFFFFF';
const TITLE_FONT_SIZE = 16;

/** Builds the Test Analytics workbook — title, every applied filter spelled out in full (never a
 *  bare "excluded"-style aside), then a bold-headered Reason -> Count table with a bold Total row
 *  — and returns it as a base64 string ready to hand to FileSystem's base64 write, matching how
 *  the rest of this app already moves binary file content around (see reportExport.ts's own ZIP
 *  handling). Never includes individual record details, matching the counts-only nature of this
 *  export on both the operator's and Admin's screens.
 */
export async function buildSummaryWorkbookBase64(
  title: string,
  filters: SummaryFilterRow[],
  byReason: ReasonCount[],
  total: number
): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TrustCheck';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Test Analytics');
  sheet.columns = [{ width: 30 }, { width: 26 }];

  const titleRow = sheet.addRow([title]);
  titleRow.getCell(1).font = { bold: true, size: TITLE_FONT_SIZE };
  sheet.mergeCells(titleRow.number, 1, titleRow.number, 2);

  const generatedRow = sheet.addRow(['Generated', new Date().toLocaleString()]);
  generatedRow.getCell(1).font = { bold: true };

  sheet.addRow([]);

  const filtersHeaderRow = sheet.addRow(['Filters applied']);
  filtersHeaderRow.getCell(1).font = { bold: true, italic: true };
  for (const f of filters) {
    const row = sheet.addRow([f.label, f.value]);
    row.getCell(1).font = { bold: true };
  }

  sheet.addRow([]);

  const tableHeaderRow = sheet.addRow(['Reason for Test', 'Count']);
  tableHeaderRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_FONT_ARGB } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle' };
  });

  for (const r of byReason) {
    sheet.addRow([r.reason, r.count]);
  }

  const totalRow = sheet.addRow(['Total', total]);
  totalRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.border = { top: { style: 'thin' } };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer).toString('base64');
}

/** Formats a date range as one readable line — "1 Jan 2026 to 7 Jan 2026" — or "All time" when
 *  neither bound is set, for the "Date range" filter row shown in the export and matching what
 *  the on-screen filter summary should say too. */
export function formatDateRangeForDisplay(fromMillis: number | null | undefined, toMillis: number | null | undefined): string {
  if (fromMillis == null && toMillis == null) return 'All time';
  const fmt = (millis: number) => new Date(millis).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  if (fromMillis != null && toMillis != null) return `${fmt(fromMillis)} to ${fmt(toMillis)}`;
  if (fromMillis != null) return `From ${fmt(fromMillis)}`;
  return `Until ${fmt(toMillis as number)}`;
}

async function shareFile(tempPath: string): Promise<void> {
  const available = await Sharing.isAvailableAsync();
  if (!available) throw new Error('Sharing is not available on this device');
  await Sharing.shareAsync(tempPath, {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    UTI: 'org.openxmlformats.spreadsheetml.sheet',
  });
}

/** Always opens the share sheet directly — no folder picker, no persisted grant — for whenever
 *  the operator/admin wants to send the file straight to someone (email, WhatsApp, etc.) instead
 *  of saving it to this device at all. */
export async function shareSummaryWorkbook(base64: string, suggestedFileName: string): Promise<void> {
  const tempPath = `${FileSystem.cacheDirectory}${suggestedFileName}`;
  await FileSystem.writeAsStringAsync(tempPath, base64, { encoding: FileSystem.EncodingType.Base64 });
  await shareFile(tempPath);
}

/**
 * Writes the workbook directly into the device's Downloads folder on Android (reusing the same
 * persisted SAF directory grant as the PDF/ZIP export in reportExport.ts, so the operator/admin
 * is never asked to pick a folder twice), or hands it to the share sheet on iOS — same platform
 * split and same reasoning as saveResultToDownloads, just for an in-memory workbook instead of an
 * already-rendered file on disk.
 */
export async function saveSummaryWorkbookToDownloads(base64: string, suggestedFileName: string): Promise<'saved' | 'shared'> {
  const tempPath = `${FileSystem.cacheDirectory}${suggestedFileName}`;
  await FileSystem.writeAsStringAsync(tempPath, base64, { encoding: FileSystem.EncodingType.Base64 });

  if (Platform.OS !== 'android') {
    await shareFile(tempPath);
    return 'shared';
  }

  let dirUri = await AsyncStorage.getItem(DOWNLOADS_DIR_URI_KEY);
  if (!dirUri) {
    const seedUri = FileSystem.StorageAccessFramework.getUriForDirectoryInRoot('Download');
    const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync(seedUri);
    if (!permission.granted) {
      await shareFile(tempPath);
      return 'shared';
    }
    dirUri = permission.directoryUri;
    await AsyncStorage.setItem(DOWNLOADS_DIR_URI_KEY, dirUri);
  }

  try {
    const destUri = await FileSystem.StorageAccessFramework.createFileAsync(
      dirUri,
      suggestedFileName,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    await FileSystem.writeAsStringAsync(destUri, base64, { encoding: FileSystem.EncodingType.Base64 });
    return 'saved';
  } catch (e) {
    await AsyncStorage.removeItem(DOWNLOADS_DIR_URI_KEY);
    console.log('[countsExport] saveSummaryWorkbookToDownloads: SAF write failed, falling back to share', e);
    await shareFile(tempPath);
    return 'shared';
  }
}
