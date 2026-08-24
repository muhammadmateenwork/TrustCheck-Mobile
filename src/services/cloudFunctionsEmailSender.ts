import { httpsCallable } from 'firebase/functions';
import * as FileSystem from 'expo-file-system/legacy';
import { functions } from './firebase';
import { TestRecord, donorFullName } from '../models/TestRecord';
import { sanitizeFileName } from './fileStorage';

/**
 * Sends the report by calling the sendReportEmail Cloud Function (functions/index.js, untouched
 * — same backend as the native app) instead of talking to an SMTP server directly from the
 * device. Mirrors CloudFunctionsEmailSender.java. The PDF bytes travel straight in the callable's
 * request payload (base64-encoded, as "pdfBase64") — no Cloud Storage involved at all, by design.
 */
export async function sendReportEmail(record: TestRecord, pdfLocalPath: string, recipientEmail: string): Promise<void> {
  const pdfBase64 = await FileSystem.readAsStringAsync(pdfLocalPath, { encoding: FileSystem.EncodingType.Base64 });
  const displayName = record.pdfDisplayName && record.pdfDisplayName.trim() !== '' ? record.pdfDisplayName.trim() : 'report';

  const data = {
    pdfBase64,
    recipientEmail,
    donorName: donorFullName(record),
    recordId: record.id,
    fileName: `${sanitizeFileName(displayName)}.pdf`,
  };

  // The default callable timeout (60s) was found too tight even for a shrunk PDF on a slow
  // connection on the native side — this app doesn't currently expose a per-call timeout option
  // through the Firebase JS SDK's httpsCallable the same way, so this relies on the Cloud
  // Function's own execution deadline instead.
  const call = httpsCallable(functions, 'sendReportEmail');
  try {
    console.log('[emailSender] calling sendReportEmail, payload bytes ~', data.pdfBase64.length);
    await call(data);
    console.log('[emailSender] sendReportEmail succeeded');
  } catch (e) {
    const code = (e as { code?: string }).code;
    console.log('[emailSender] sendReportEmail failed, code =', code, e);
    // 'internal'/'deadline-exceeded'/'unavailable' are the codes a cold Cloud Function container
    // (one that hasn't handled a request in a while and has to spin back up) surfaces as — the
    // exact same request tends to succeed immediately once retried against the now-warm
    // container, which is what made this look like an intermittent bug rather than the
    // consistent cold-start pattern it actually is. One retry, not a loop — a second genuine
    // failure is a real problem the operator should see, not something to keep silently masking.
    if (code === 'internal' || code === 'deadline-exceeded' || code === 'unavailable') {
      console.log('[emailSender] retrying once after transient error');
      await call(data);
      console.log('[emailSender] retry succeeded');
      return;
    }
    throw e;
  }
}
