import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
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
