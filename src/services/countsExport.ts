import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ReasonCount } from './cloudSync';
import { DOWNLOADS_DIR_URI_KEY } from './reportExport';

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** One row per applied filter (e.g. "Operator,jane@company.com" / "From,2026-01-01"), shown at
 *  the top of the CSV above the counts table so the exported file is self-describing on its own,
 *  without needing the app open to know what it's a count of. */
export interface CsvFilterRow {
  label: string;
  value: string;
}

/** Builds the counts CSV content: applied filters, a blank line, then a Reason -> Count row per
 *  REASON_FOR_TEST_OPTIONS value plus a Total row — never individual record details, matching
 *  the counts-only nature of this export on both the operator's and Admin's screens. */
export function buildCountsCsv(filters: CsvFilterRow[], byReason: ReasonCount[], total: number): string {
  const lines: string[] = ['TrustCheck Test Summary', `Generated,${new Date().toISOString()}`];
  for (const f of filters) {
    lines.push(`${csvEscape(f.label)},${csvEscape(f.value)}`);
  }
  lines.push('');
  lines.push('Reason for Test,Count');
  for (const r of byReason) {
    lines.push(`${csvEscape(r.reason)},${r.count}`);
  }
  lines.push(`Total,${total}`);
  return lines.join('\n');
}

async function shareCsv(tempPath: string): Promise<void> {
  const available = await Sharing.isAvailableAsync();
  if (!available) throw new Error('Sharing is not available on this device');
  await Sharing.shareAsync(tempPath, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
}

/**
 * Writes the counts CSV directly into the device's Downloads folder on Android (reusing the same
 * persisted SAF directory grant as the PDF/ZIP export in reportExport.ts, so the operator/admin
 * is never asked to pick a folder twice), or hands it to the share sheet on iOS — same platform
 * split and same reasoning as saveResultToDownloads, just for in-memory CSV text instead of an
 * already-rendered file on disk.
 */
export async function saveCsvToDownloads(csvContent: string, suggestedFileName: string): Promise<'saved' | 'shared'> {
  const tempPath = `${FileSystem.cacheDirectory}${suggestedFileName}`;
  await FileSystem.writeAsStringAsync(tempPath, csvContent);

  if (Platform.OS !== 'android') {
    await shareCsv(tempPath);
    return 'shared';
  }

  let dirUri = await AsyncStorage.getItem(DOWNLOADS_DIR_URI_KEY);
  if (!dirUri) {
    const seedUri = FileSystem.StorageAccessFramework.getUriForDirectoryInRoot('Download');
    const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync(seedUri);
    if (!permission.granted) {
      await shareCsv(tempPath);
      return 'shared';
    }
    dirUri = permission.directoryUri;
    await AsyncStorage.setItem(DOWNLOADS_DIR_URI_KEY, dirUri);
  }

  try {
    const destUri = await FileSystem.StorageAccessFramework.createFileAsync(dirUri, suggestedFileName, 'text/csv');
    await FileSystem.writeAsStringAsync(destUri, csvContent);
    return 'saved';
  } catch (e) {
    await AsyncStorage.removeItem(DOWNLOADS_DIR_URI_KEY);
    console.log('[countsExport] saveCsvToDownloads: SAF write failed, falling back to share', e);
    await shareCsv(tempPath);
    return 'shared';
  }
}
