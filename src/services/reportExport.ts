import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import JSZip from 'jszip';
import { TestRecord } from '../models/TestRecord';
import { loadRecordForAdmin } from './cloudSync';
import { getOrGeneratePdf, suggestFileName } from './pdfReportGenerator';
import { saveRecord } from './recordRepository';
import { sanitizeFileName } from './fileStorage';

/**
 * Pure building blocks for Admin's bulk report download — the queueing, pause/resume/cancel, and
 * background-service orchestration around these live in downloadQueue.ts, which is the only
 * caller. Kept separate so these stay simple, testable, unaware of job state.
 */

/** Loads one Admin record's full data (photos/signatures) and generates its PDF, mirroring
 *  Admin's own single-record "Open" flow. */
export async function generateRecordPdf(summary: TestRecord, mediaUrls: Record<string, string> | null): Promise<string> {
  const fullRecord = await loadRecordForAdmin(summary, mediaUrls);
  const pdfPath = await getOrGeneratePdf(fullRecord);
  await saveRecord(fullRecord); // persists the now-set pdfPath, same as Admin's own openRecord
  return pdfPath;
}

/** Bundles already-generated PDFs into one ZIP, named per record (falling back to a numeric
 *  suffix on collision), and returns its path. Callers with exactly one PDF should skip this and
 *  share the lone PDF directly instead — a single selection shouldn't get wrapped in a zip for no
 *  reason (explicit product direction). */
export async function zipPdfPaths(pdfPaths: string[], summaries: TestRecord[]): Promise<string> {
  const zip = new JSZip();
  const usedNames = new Set<string>();
  for (let i = 0; i < pdfPaths.length; i++) {
    const path = pdfPaths[i];
    const base64 = await FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.Base64 });
    const baseName = sanitizeFileName(
      summaries[i].pdfDisplayName && summaries[i].pdfDisplayName!.trim() !== ''
        ? summaries[i].pdfDisplayName
        : suggestFileName(summaries[i])
    );
    let fileName = `${baseName}.pdf`;
    let suffix = 2;
    while (usedNames.has(fileName)) {
      fileName = `${baseName}_${suffix}.pdf`;
      suffix++;
    }
    usedNames.add(fileName);
    zip.file(fileName, base64, { base64: true });
  }
  const zipBase64 = await zip.generateAsync({ type: 'base64' });
  const zipPath = `${FileSystem.cacheDirectory}TrustCheck_Reports_${Date.now()}.zip`;
  await FileSystem.writeAsStringAsync(zipPath, zipBase64, { encoding: FileSystem.EncodingType.Base64 });
  return zipPath;
}

/** Hands a finished result (single PDF or ZIP) to the OS share sheet — invoked on demand from the
 *  Downloads panel once a job completes, rather than popping a share sheet unprompted the instant
 *  a background job happens to finish while the operator is elsewhere in the app. */
export async function shareResult(path: string, isZip: boolean): Promise<void> {
  const available = await Sharing.isAvailableAsync();
  if (!available) throw new Error('Sharing is not available on this device');
  await Sharing.shareAsync(
    path,
    isZip ? { mimeType: 'application/zip', UTI: 'public.zip-archive' } : { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' }
  );
}

// Persists the SAF directory grant across app restarts so the operator only has to pick a folder
// (in practice: Downloads) the FIRST time they ever download something — every subsequent job
// writes straight into it without asking again. There is no equivalent AsyncStorage key needed on
// iOS; that platform has no public-folder write API at all (see saveResultToDownloads's own doc).
const DOWNLOADS_DIR_URI_KEY = 'admin_downloads_dir_uri';

/**
 * Writes a finished result (single PDF or ZIP) directly into a real, user-visible folder on
 * device storage — the actual fix for "downloads should land somewhere findable, the way a normal
 * browser download does," instead of only ever being reachable through Share (which requires the
 * operator to explicitly choose "Save to Files"/"Save to Downloads" from the share sheet every
 * single time, and previously was the ONLY way to get the file out of the app's private cache
 * directory at all).
 *
 * PLATFORM DIFFERENCE, not a bug: Android's Storage Access Framework lets an app write directly
 * into a public folder once the operator grants access to it (requestDirectoryPermissionsAsync,
 * pre-seeded to open at Downloads) — that grant is persisted here (AsyncStorage) so it only
 * happens once, not on every download. iOS has no equivalent write-to-a-public-folder API for any
 * app; the closest thing the platform offers is exactly the existing share-sheet flow ("Save to
 * Files" is a user-driven action, not something an app can trigger directly), so iOS keeps using
 * shareResult. Returns which path actually happened so the caller can show the right toast.
 */
export async function saveResultToDownloads(path: string, isZip: boolean, suggestedName: string): Promise<'saved' | 'shared'> {
  if (Platform.OS !== 'android') {
    await shareResult(path, isZip);
    return 'shared';
  }

  const mimeType = isZip ? 'application/zip' : 'application/pdf';
  let dirUri = await AsyncStorage.getItem(DOWNLOADS_DIR_URI_KEY);
  if (!dirUri) {
    const seedUri = FileSystem.StorageAccessFramework.getUriForDirectoryInRoot('Download');
    const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync(seedUri);
    if (!permission.granted) {
      // Operator declined the folder picker -- fall back to Share rather than leaving them with
      // no way to get the file out at all.
      await shareResult(path, isZip);
      return 'shared';
    }
    dirUri = permission.directoryUri;
    await AsyncStorage.setItem(DOWNLOADS_DIR_URI_KEY, dirUri);
  }

  try {
    const base64 = await FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.Base64 });
    const destUri = await FileSystem.StorageAccessFramework.createFileAsync(dirUri, suggestedName, mimeType);
    await FileSystem.writeAsStringAsync(destUri, base64, { encoding: FileSystem.EncodingType.Base64 });
    return 'saved';
  } catch (e) {
    // Most likely cause: the previously granted directory URI was revoked (folder deleted/moved,
    // or the operator revoked the permission in Android Settings) -- clear the stale grant so the
    // NEXT attempt re-prompts instead of failing the same way indefinitely.
    await AsyncStorage.removeItem(DOWNLOADS_DIR_URI_KEY);
    console.log('[reportExport] saveResultToDownloads: SAF write failed, falling back to share', e);
    await shareResult(path, isZip);
    return 'shared';
  }
}
