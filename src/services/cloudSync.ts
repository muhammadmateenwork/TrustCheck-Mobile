import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  orderBy,
  where,
  limit,
  startAfter,
  onSnapshot,
  QueryDocumentSnapshot,
  DocumentData,
  Unsubscribe,
  FirestoreError,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import * as FileSystem from 'expo-file-system/legacy';
import { firebaseAuth, firestore, storage } from './firebase';
import { TestRecord, STATUS_COMPLETED } from '../models/TestRecord';
import { saveRecord, loadRecord } from './recordRepository';
import { listRecordJsonFiles } from './fileStorage';

/**
 * Best-effort background sync of a completed test record to Firestore + its photos/signatures to
 * Cloud Storage — mirrors CloudSyncRepository.java: a skipped-login (anonymous) session never
 * syncs at all, matching native exactly. This was briefly changed to sync anonymous sessions too
 * (per an earlier explicit ask), then reverted back to native's original behavior (per a later,
 * more specific explicit ask): anonymous test data must stay purely local-only — never reach
 * Firestore/Cloud Storage, never appear in the Admin panel, never be able to email a report (see
 * SummaryScreen's own doc on why the Send Email button is hidden for anonymous sessions). The one
 * thing that stays operator-only regardless is the operator PROFILE (name/ID/phone prefill) — see
 * OperatorConsentScreen's own doc — since that's tied to a real, reusable identity in a way a
 * one-off anonymous session isn't.
 *
 * Purely additive on top of this app's local-first storage (see recordRepository.ts): the donor
 * test workflow and PDF generation already succeed or fail independently of this, entirely from
 * the local copy. A sync failure here is logged and otherwise silent by default; it never
 * surfaces as an error to the operator unless the caller passes an onComplete callback (see
 * summarySave screen, which waits on it with a timeout — see that screen's own doc for why).
 */
export async function syncRecord(
  record: TestRecord,
  onComplete?: (synced: boolean) => void,
  onProgress?: (percent: number) => void
): Promise<void> {
  const user = firebaseAuth.currentUser;
  console.log('[cloudSync] syncRecord: user =', user ? user.uid : null, 'anonymous =', user?.isAnonymous);
  if (!user || user.isAnonymous) {
    console.log('[cloudSync] syncRecord: no signed-in (non-anonymous) user, skipping');
    onComplete?.(false);
    return;
  }

  try {
    const uploads: Array<[string, string | null]> = [
      ['donorSignature', record.donor.signaturePath],
      ['donorIdPhoto', record.donor.idPhotoPath],
      ['operatorConsentSignature', record.operatorConsent.signaturePath],
      ['drugTestPhoto', record.drugTestPhotoPath],
      ['drugResultConfirmationSignature', record.drugResult.confirmationSignaturePath],
      ['alcoholTestPhoto', record.alcoholTestPhotoPath],
      ['alcoholTestPhoto2', record.alcoholTestPhotoPath2],
      ['finalSignOffSignature', record.finalSignOff.signaturePath],
    ];

    // Progress is aggregated by file COUNT (each of the up to 8 upload slots worth an equal
    // share), not by byte size — matching restoreOneRecord's own reasoning below in this file: a
    // byte-weighted bar sits near 0% for the whole wait while one larger photo uploads, then jumps
    // straight to done, which reads as stuck rather than progressing. The last 10% is reserved for
    // the Firestore document write itself, which follows all the uploads.
    let completedUploads = 0;
    const reportUploadProgress = () => {
      completedUploads++;
      onProgress?.(Math.round((completedUploads / uploads.length) * 90));
    };

    // Up to 8 independent uploads — running them one at a time serialized the full round-trip
    // latency of every media file instead of just the slowest one, directly extending how long
    // the Summary screen's Save button sits waiting on CLOUD_SYNC_TIMEOUT_MS.
    const uploadResults = await Promise.all(
      uploads.map(async ([key, localPath]): Promise<[string, string] | null> => {
        try {
          if (!localPath) return null;
          const info = await FileSystem.getInfoAsync(localPath);
          if (!info.exists) {
            console.log('[cloudSync] syncRecord: skipping', key, '- local file missing:', localPath);
            return null;
          }
          const fileName = localPath.substring(localPath.lastIndexOf('/') + 1);
          const url = await uploadLocalFile(localPath, `testRecords/${record.id}/${fileName}`);
          console.log('[cloudSync] syncRecord: uploaded', key);
          return [key, url];
        } finally {
          reportUploadProgress();
        }
      })
    );
    const mediaUrls: Record<string, string> = {};
    for (const result of uploadResults) {
      if (result) mediaUrls[result[0]] = result[1];
    }
    console.log('[cloudSync] syncRecord: media uploaded, keys =', Object.keys(mediaUrls));

    await setDoc(doc(firestore, 'testRecords', record.id), {
      record,
      mediaUrls,
      operatorUid: user.uid,
      operatorEmail: user.email,
      syncedAt: Date.now(),
    });
    console.log('[cloudSync] syncRecord: firestore doc written for', record.id);
    onProgress?.(100);

    record.cloudSynced = true;
    await saveRecord(record);
    onComplete?.(true);
  } catch (e) {
    // Records are immutable once created (see firestore.rules: create-only, update/delete always
    // denied) — the only way a write to OUR OWN record.id (a UUID we generated) can come back
    // "permission denied" is if this exact document already exists, meaning an earlier attempt's
    // write actually succeeded but the follow-up local cloudSynced flag never got saved. Without
    // this, retryPendingSyncs() would retry that record forever.
    const code = (e as { code?: string }).code;
    if (code === 'permission-denied') {
      // Confirm the doc actually exists before trusting the "must already be written" inference
      // above — a rules change, a deactivated operator, or a revoked token could also produce
      // permission-denied, and wrongly marking cloudSynced here would make retryPendingSyncs()
      // give up on a record that never actually reached Firestore.
      try {
        const snap = await getDoc(doc(firestore, 'testRecords', record.id));
        if (snap.exists()) {
          record.cloudSynced = true;
          await saveRecord(record);
          onComplete?.(true);
          return;
        }
      } catch {
        // couldn't even confirm — fall through and report failure below
      }
      console.warn('Cloud sync permission-denied and record not confirmed to exist for', record.id, e);
      onComplete?.(false);
      return;
    }
    console.warn('Cloud sync failed for record', record.id, e);
    onComplete?.(false);
  }
}

/** Firebase JS SDK's uploadBytes needs a Blob, not a local file path the way Android's
 *  putFile(Uri) does — fetch() the local file URI (works for file:// URIs in RN) and hand its
 *  Blob straight to Storage. */
async function uploadLocalFile(localUri: string, storagePath: string): Promise<string> {
  const response = await fetch(localUri);
  const blob = await response.blob();
  const ref = storageRef(storage, storagePath);
  await uploadBytes(ref, blob);
  return getDownloadURL(ref);
}

/**
 * syncRecord() is a one-shot, best-effort attempt — if the device has no connectivity at the
 * exact moment a test is saved, it fails silently and nothing ever retries it on its own, which
 * is exactly what let completed tests go permanently missing from the Admin panel despite saving
 * locally without any visible error. This re-attempts every one of the current operator's local
 * records not yet confirmed synced — cheap to call often since already-synced records are
 * skipped, so it's safe to run on every visit to Home, not just once after Save.
 */
export async function retryPendingSyncs(): Promise<void> {
  const user = firebaseAuth.currentUser;
  if (!user || user.isAnonymous) return;

  const paths = await listRecordJsonFiles();
  for (const path of paths) {
    try {
      const text = await FileSystem.readAsStringAsync(path);
      const record = JSON.parse(text) as TestRecord;
      // Same scoping RecordRepository#listAllRecords enforces for local reads: only THIS
      // operator's own COMPLETED tests. Without it, a shared device mid-shift-handover could pick
      // up another operator's still-in-progress draft or unsynced record and upload it stamped
      // with the current signed-in user's identity (syncRecord always writes operatorUid/
      // operatorEmail from firebaseAuth.currentUser).
      if (record && !record.cloudSynced && record.operatorUid === user.uid && record.status === STATUS_COMPLETED) {
        await syncRecord(record);
      }
    } catch {
      // skip unreadable file
    }
  }
}

export interface RecordsPage {
  records: TestRecord[];
  mediaUrlsByRecordId: Record<string, Record<string, string>>;
  cursor: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

/** Inclusive [from, to] range, both as millis-since-epoch (matching how `syncedAt` is actually
 *  stored — see syncRecord's own `syncedAt: Date.now()`, a plain number, not a Firestore
 *  Timestamp) — used by Admin's date-range/month report filter. Either bound may be omitted. */
export interface DateRange {
  fromMillis: number | null;
  toMillis: number | null;
}

/**
 * Admin panel's Records list — server-side paginated, newest first, optionally filtered to one
 * operator's email and/or a syncedAt date range. Mirrors CloudSyncRepository#fetchAllRecordsPage,
 * with the date-range filter added on top (no native equivalent — Admin-only bulk report
 * download feature, see reportExport.ts). The range filter is on the SAME field the query already
 * orders by (syncedAt), which Firestore can serve from the same index already required for the
 * operatorEmail-equality + syncedAt-orderBy combination — no separate composite index needed.
 */
export async function fetchAllRecordsPage(
  cursor: QueryDocumentSnapshot<DocumentData> | null,
  operatorEmailFilter: string | null,
  pageSize: number,
  dateRange?: DateRange | null
): Promise<RecordsPage> {
  const testRecordsRef = collection(firestore, 'testRecords');
  const clauses = [orderBy('syncedAt', 'desc')];
  if (operatorEmailFilter) {
    clauses.push(where('operatorEmail', '==', operatorEmailFilter) as never);
  }
  if (dateRange?.fromMillis != null) {
    clauses.push(where('syncedAt', '>=', dateRange.fromMillis) as never);
  }
  if (dateRange?.toMillis != null) {
    clauses.push(where('syncedAt', '<=', dateRange.toMillis) as never);
  }
  clauses.push(limit(pageSize) as never);
  if (cursor) clauses.push(startAfter(cursor) as never);

  const snapshot = await getDocs(query(testRecordsRef, ...clauses));
  const docs = snapshot.docs;
  const hasMore = docs.length === pageSize;
  const newCursor = docs.length > 0 ? docs[docs.length - 1] : cursor;

  const records: TestRecord[] = [];
  const mediaUrlsByRecordId: Record<string, Record<string, string>> = {};
  for (const d of docs) {
    const record = extractRecord(d.data());
    if (record) {
      records.push(record);
      const mediaUrls = d.data().mediaUrls as Record<string, string> | undefined;
      if (mediaUrls) mediaUrlsByRecordId[record.id] = mediaUrls;
    }
  }
  return { records, mediaUrlsByRecordId, cursor: newCursor, hasMore };
}

/**
 * Live listener on just the single most recent record matching operatorEmailFilter — deliberately
 * narrow (a one-document watch, not a full live-updating paginated list) since combining
 * onSnapshot with fetchAllRecordsPage's own limit()/startAfter() pagination is a much harder
 * thing to get right. Mirrors CloudSyncRepository#watchNewestRecordId. Returns the unsubscribe
 * function — call it when no longer needed (e.g. on screen unmount) to avoid leaking the listener.
 */
export function watchNewestRecordId(
  operatorEmailFilter: string | null,
  callback: (id: string | null) => void
): Unsubscribe {
  const testRecordsRef = collection(firestore, 'testRecords');
  const clauses = [orderBy('syncedAt', 'desc'), limit(1)];
  if (operatorEmailFilter) {
    clauses.splice(1, 0, where('operatorEmail', '==', operatorEmailFilter) as never);
  }
  const q = query(testRecordsRef, ...(clauses as never[]));
  return onSnapshot(
    q,
    (snapshot) => {
      callback(snapshot.docs.length > 0 ? snapshot.docs[0].id : null);
    },
    (_error: FirestoreError) => {
      // No caller currently needs error visibility here — matches the native app's own listener,
      // which also only wires the success path.
    }
  );
}

/**
 * Reads the embedded TestRecord out of a testRecords/{id} document, with one correction: the
 * embedded copy's emailSent is frozen at whatever it was the moment this device (or another
 * device) synced the record, and never updates afterward — records are immutable once created.
 * The sendReportEmail Cloud Function separately stamps a top-level emailSent field on the same
 * document when it actually sends (it runs with admin privileges) — that field IS kept current,
 * so it wins here whenever it says true. Mirrors CloudSyncRepository#extractRecord.
 */
function extractRecord(data: DocumentData): TestRecord | null {
  const record = data.record as TestRecord | undefined;
  if (!record) return null;
  if (data.emailSent === true) {
    record.emailSent = true;
  }
  return record;
}

export interface DownloadProgressCallback {
  (percent: number): void;
}

/**
 * Admin-only: full record (with media downloaded locally, same as an operator's own restore) for
 * one record an admin has tapped into from the all-operators list. Uses the local copy if this
 * device already has one rather than re-downloading. Mirrors
 * CloudSyncRepository#loadRecordForAdmin.
 *
 * @param knownMediaUrls the same record's mediaUrls map, if the caller already has it from a
 *                        recent fetchAllRecordsPage() call — skips a redundant Firestore read.
 */
export async function loadRecordForAdmin(
  summary: TestRecord,
  knownMediaUrls: Record<string, string> | null,
  onProgress?: DownloadProgressCallback
): Promise<TestRecord> {
  const cached = await loadRecord(summary.id);
  if (cached) return cached;

  let mediaUrls = knownMediaUrls;
  let record = summary;
  if (!mediaUrls) {
    const snap = await getDoc(doc(firestore, 'testRecords', summary.id));
    if (!snap.exists()) throw new Error('Record not found');
    const extracted = extractRecord(snap.data());
    if (!extracted) throw new Error('Record not found');
    record = extracted;
    mediaUrls = (snap.data().mediaUrls as Record<string, string> | undefined) ?? {};
  }

  await restoreOneRecord(record, mediaUrls, onProgress);
  return record;
}

/** Downloads every media file listed in mediaUrls to local storage, patches the record's own
 *  path fields to point at the newly-downloaded local files, then saves the reconstructed record
 *  locally — same shape as a record actually created on this device. Progress is aggregated by
 *  file COUNT (each file worth 1/N of the total), not by byte size, matching the fix already
 *  applied on the native side for why a jumpy "0% then suddenly 100%" progress bar happened when
 *  weighted by bytes instead. */
async function restoreOneRecord(
  record: TestRecord,
  mediaUrls: Record<string, string>,
  onProgress?: DownloadProgressCallback
): Promise<void> {
  // A record restored onto this device is starting a fresh local life here: whatever pdfPath
  // synced from the original device points at a file that doesn't exist on this filesystem (the
  // PDF viewer/Summary screen already regenerate on demand if missing, so this is just making
  // sure they actually take that path instead of trying a stale one first), and cloudSynced must
  // be forced true — leaving it at its embedded, possibly-stale `false` would make
  // retryPendingSyncs() re-upload every media file of a record that's already in Firestore (that's
  // the whole reason it exists on this device to restore in the first place).
  record.pdfPath = null;
  record.cloudSynced = true;

  const keys = Object.keys(mediaUrls);
  if (keys.length === 0) {
    await saveRecord(record);
    onProgress?.(100);
    return;
  }

  const { mediaDir } = await import('./fileStorage');
  const dir = await mediaDir(record.id);
  let completed = 0;

  const setPath = (field: string, localPath: string) => {
    switch (field) {
      case 'donorSignature': record.donor.signaturePath = localPath; break;
      case 'donorIdPhoto': record.donor.idPhotoPath = localPath; break;
      case 'operatorConsentSignature': record.operatorConsent.signaturePath = localPath; break;
      case 'drugTestPhoto': record.drugTestPhotoPath = localPath; break;
      case 'drugResultConfirmationSignature': record.drugResult.confirmationSignaturePath = localPath; break;
      case 'alcoholTestPhoto': record.alcoholTestPhotoPath = localPath; break;
      case 'alcoholTestPhoto2': record.alcoholTestPhotoPath2 = localPath; break;
      case 'finalSignOffSignature': record.finalSignOff.signaturePath = localPath; break;
    }
  };

  // Independent downloads — same reasoning as syncRecord's upload fan-out above, and this one
  // directly gates the "Opening Record" progress modal in the Admin panel.
  //
  // One broken URL (a deleted/expired Storage object — realistic for records that predate a fix
  // earlier in this app's own history) must not take the whole record down with it. Mirrors
  // CloudSyncRepository#restoreOneRecord's own failedKeys handling: a failed download is skipped
  // — that one field is simply left unset on the restored record (renders as "(no photo)"/empty
  // signature box, same as any other missing media) — rather than throwing and preventing the
  // admin from viewing everything else that DID download successfully.
  await Promise.all(
    keys.map(async (key) => {
      try {
        const url = mediaUrls[key];
        const extension = url.includes('.png') || key.toLowerCase().includes('signature') ? 'png' : 'jpg';
        const localPath = `${dir}${key}.${extension}`;
        const result = await FileSystem.downloadAsync(url, localPath);
        if (result.status !== 200) {
          throw new Error(`status ${result.status}`);
        }
        setPath(key, localPath);
      } catch (e) {
        console.warn('Could not restore media for', key, 'on record', record.id, e);
      } finally {
        completed++;
        onProgress?.(Math.round((completed / keys.length) * 100));
      }
    })
  );

  await saveRecord(record);
}

