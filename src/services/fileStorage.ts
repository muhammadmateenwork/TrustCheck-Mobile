import * as FileSystem from 'expo-file-system/legacy';

/**
 * All app data lives under the app's private document/cache directories — mirrors
 * FileStorageManager.java's layout exactly:
 *   {documentDirectory}records/{id}.json   - one JSON file per donor test record (source of truth)
 *   {documentDirectory}media/{id}/*        - photos and signature images for that record
 *   {cacheDirectory}pdfs/{id}/{name}.pdf   - the PDF report, regenerated on demand from the two
 *                                            directories above rather than kept as a second
 *                                            permanent copy of data already captured in them.
 *                                            Deliberately under cache, not documents — the OS is
 *                                            free to reclaim it under storage pressure, and the
 *                                            PDF generator always rebuilds it if missing.
 */

const BASE = FileSystem.documentDirectory ?? '';
const CACHE = FileSystem.cacheDirectory ?? '';

async function ensureDir(path: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(path, { intermediates: true });
  }
}

export async function recordsDir(): Promise<string> {
  const dir = `${BASE}records/`;
  await ensureDir(dir);
  return dir;
}

export async function mediaDir(recordId: string): Promise<string> {
  const dir = `${BASE}media/${recordId}/`;
  await ensureDir(dir);
  return dir;
}

export async function pdfsDir(): Promise<string> {
  const dir = `${CACHE}pdfs/`;
  await ensureDir(dir);
  return dir;
}

export async function pdfDir(recordId: string): Promise<string> {
  const dir = `${await pdfsDir()}${recordId}/`;
  await ensureDir(dir);
  return dir;
}

/** Strips anything that isn't safe/sensible in a file name the operator chose freely, without
 *  rejecting the input outright — spaces become underscores, everything else disallowed is just
 *  dropped. Falls back to a generic name if that leaves nothing usable. */
export function sanitizeFileName(name: string | null | undefined): string {
  if (!name) return 'Report';
  const cleaned = name.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, '');
  return cleaned === '' ? 'Report' : cleaned;
}

export async function pdfFilePath(recordId: string, displayName: string | null): Promise<string> {
  return `${await pdfDir(recordId)}${sanitizeFileName(displayName)}.pdf`;
}

export async function recordJsonPath(recordId: string): Promise<string> {
  return `${await recordsDir()}${recordId}.json`;
}

function shortId(): string {
  return Math.random().toString(16).slice(2, 10);
}

export async function newMediaFilePath(recordId: string, prefix: string): Promise<string> {
  return `${await mediaDir(recordId)}${prefix}_${shortId()}.png`;
}

export async function newPhotoFilePath(recordId: string, prefix: string): Promise<string> {
  return `${await mediaDir(recordId)}${prefix}_${shortId()}.jpg`;
}

export async function listRecordJsonFiles(): Promise<string[]> {
  const dir = await recordsDir();
  const names = await FileSystem.readDirectoryAsync(dir);
  return names.filter((n) => n.endsWith('.json')).map((n) => `${dir}${n}`);
}

export async function deleteRecordFiles(recordId: string): Promise<void> {
  const jsonPath = `${await recordsDir()}${recordId}.json`;
  const media = `${BASE}media/${recordId}/`;
  const pdf = `${await pdfsDir()}${recordId}/`;
  await Promise.all([
    FileSystem.deleteAsync(jsonPath, { idempotent: true }),
    FileSystem.deleteAsync(media, { idempotent: true }),
    FileSystem.deleteAsync(pdf, { idempotent: true }),
  ]);
}
