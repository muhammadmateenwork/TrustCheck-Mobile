import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MaterialIcons } from '@expo/vector-icons';
import * as ScreenCapture from 'expo-screen-capture';
import { RootStackParamList } from '../navigation/types';
import { useWorkflow } from '../hooks/WorkflowContext';
import { STATUS_COMPLETED, STATUS_IN_PROGRESS, donorFullName } from '../models/TestRecord';
import { saveRecord } from '../services/recordRepository';
import { generatePdf, getOrGeneratePdf, generatePdfToTempFile, suggestFileName } from '../services/pdfReportGenerator';
import { syncRecord } from '../services/cloudSync';
import { sendReportEmail } from '../services/cloudFunctionsEmailSender';
import { firebaseAuth } from '../services/firebase';
import { formatDateTime } from '../utils/dateUtils';
import TextField from '../components/TextField';
import Button from '../components/Button';
import RecordDetailView from '../components/RecordDetailView';
import { useToast } from '../components/Toast';
import KeyboardAvoidingScreen from '../components/KeyboardAvoidingScreen';
import { colors } from '../theme';
import * as FileSystem from 'expo-file-system/legacy';

type Props = NativeStackScreenProps<RootStackParamList, 'Summary'>;

// TEMPORARY, for testing: every report goes to this address regardless of the recipient entered
// on Test Setup, matching SummaryFragment.java's own TEST_RECIPIENT_OVERRIDE — remove this
// override (and go back to using testSetup.recipientEmail directly) once testing is done.
const TEST_RECIPIENT_OVERRIDE = 'trustcheck.test@gmail.com';

// How long onSaved() waits for the cloud sync before revealing the Saved screen anyway. The
// record is already safely saved locally regardless of this; this bound exists because
// Firestore's offline write queue can leave a write's own completion callback never firing at all
// while genuinely offline, and this screen shouldn't leave the operator stuck indefinitely for
// something that isn't actually blocking anything real.
//
// 12s (SummaryFragment.java's original CLOUD_SYNC_TIMEOUT_MS) turned out too short here: a record
// with all 8 media slots populated legitimately takes longer than that to upload on an ordinary
// connection, so the timeout was firing and showing "will sync later" on records that then went
// on to sync successfully a few seconds afterward — a false "you're offline"-sounding message on
// a perfectly working upload. 45s gives real uploads enough room while still existing as a genuine
// safety net for an actually-offline device (Firestore would otherwise queue the write and never
// call back at all).
const CLOUD_SYNC_TIMEOUT_MS = 45000;

/**
 * Mirrors SummaryFragment.java. Two stages on one screen: Review (read-only summary + editable
 * report file name + Save) and Saved (Open PDF / Send Email / Back to Home) — tapping Save
 * generates the PDF, writes the record locally, and waits for the cloud sync to actually finish
 * (bounded by CLOUD_SYNC_TIMEOUT_MS) before switching over, so the record has genuinely reached
 * Firestore by the time the operator sees "Saved" — see cloudSync.syncRecord's own doc for why
 * that wait was added.
 */
export default function SummaryScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { record, clear } = useWorkflow();
  const { showToast } = useToast();

  const [pdfDisplayName, setPdfDisplayName] = useState(
    record.pdfDisplayName && record.pdfDisplayName.trim() !== '' ? record.pdfDisplayName : suggestFileName(record)
  );
  const [saving, setSaving] = useState(false);
  const [savingStatus, setSavingStatus] = useState('');
  // null while generating the PDF (no meaningful percentage yet) — a number once the cloud
  // upload starts, driven by syncRecord's own progress callback.
  const [savingProgress, setSavingProgress] = useState<number | null>(null);
  const [saved, setSaved] = useState(record.status === STATUS_COMPLETED);
  const [pdfPath, setPdfPath] = useState<string | null>(record.pdfPath);
  const [sendingEmail, setSendingEmail] = useState(false);

  // Set right before the screen intentionally navigates itself away (see onBackToHome) so the
  // beforeRemove guard below doesn't intercept that navigation too — navigation.reset() (and
  // replace()) fire beforeRemove on the screen being removed exactly the same as a back gesture
  // does, so without this flag, confirming "Yes" on the alert triggers onBackToHome(), which calls
  // navigation.reset(), which re-fires this same listener with saved still true, which
  // preventDefault()s THAT navigation too and shows the alert again — back button and the "Back to
  // Home" button both looked like they simply did nothing.
  const allowLeave = useRef(false);

  const revealed = useRef(false);

  // The review/saved summary shows every photo and signature on the record, same sensitivity as
  // the PDF viewer — block screenshots/recording here too (see PdfViewerScreen's own doc for why
  // expo-screen-capture is the RN equivalent of the native app's FLAG_SECURE window flag).
  useEffect(() => {
    void ScreenCapture.preventScreenCaptureAsync();
    return () => {
      void ScreenCapture.allowScreenCaptureAsync();
    };
  }, []);

  // Once Saved, any attempt to leave this screen (hardware/gesture back — the explicit "Back to
  // Home" button already means exactly what it says and doesn't need to ask again) should confirm
  // first rather than silently popping back into the now-finalized wizard. While a save or email
  // send is actually in flight, back is swallowed outright (mirrors SummaryFragment.java's
  // busyBackCallback) — without this, backing out mid-operation could pop this screen while
  // onSave/onSendEmail's background work is still running and later tries to update state on an
  // unmounted screen (record.status is already COMPLETED and persisted by the time saving starts,
  // so popping back into the wizard here would let the operator edit an already-finalized record).
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (allowLeave.current) return;
      if (saving || sendingEmail) {
        e.preventDefault();
        return;
      }
      if (!saved) return;
      e.preventDefault();
      Alert.alert('Go to home page?', 'Do you want to go to the home page?', [
        { text: 'No', style: 'cancel' },
        { text: 'Yes', onPress: () => void onBackToHome() },
      ]);
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, saved, saving, sendingEmail]);

  const onSave = async () => {
    console.log('[Summary] onSave: start, record', record.id);
    record.pdfDisplayName = pdfDisplayName.trim() || suggestFileName(record);
    setSaving(true);
    setSavingStatus('Saving record and generating report…');
    setSavingProgress(null);

    // Step 1: persist the record itself — this must succeed before anything downstream (cloud
    // sync, PDF, Admin visibility) can happen at all. Only mark the record complete once it's
    // about to be persisted, not any earlier.
    record.status = STATUS_COMPLETED;
    try {
      await saveRecord(record);
      console.log('[Summary] onSave: local record saved');
    } catch (e) {
      console.log('[Summary] onSave: local save threw', e);
      record.status = STATUS_IN_PROGRESS;
      setSaving(false);
      Alert.alert('Could not save', String(e));
      return;
    }

    // Step 2: generate the PDF. A failure here only costs the PDF preview, never the underlying
    // test record, which already saved above.
    let pdfError: unknown = null;
    let generatedPath: string | null = null;
    try {
      generatedPath = await generatePdf(record);
      await saveRecord(record); // persist the now-set pdfPath alongside everything else
      console.log('[Summary] onSave: pdf generated at', generatedPath);
    } catch (e) {
      console.log('[Summary] onSave: pdf generation threw', e);
      pdfError = e;
    }
    setPdfPath(generatedPath);

    await onSaved(pdfError);
  };

  const onSaved = async (pdfError: unknown) => {
    setSavingStatus('Saving data…');
    setSavingProgress(0);

    revealed.current = false;
    const reveal = (synced: boolean) => {
      if (revealed.current) return;
      revealed.current = true;
      setSaving(false);
      setSaved(true);
      if (pdfError) {
        showToast("Saved — the PDF report will be created the next time you open it.", 'info');
      } else if (!synced) {
        showToast('Saved locally — syncing is taking longer than usual and will finish in the background.', 'info');
      }
    };

    console.log('[Summary] onSaved: syncing to cloud…');
    const timeout = setTimeout(() => {
      console.log('[Summary] onSaved: cloud sync timed out after', CLOUD_SYNC_TIMEOUT_MS, 'ms, revealing anyway');
      reveal(false);
    }, CLOUD_SYNC_TIMEOUT_MS);
    await syncRecord(
      record,
      (synced) => {
        console.log('[Summary] onSaved: syncRecord completed, synced =', synced);
        clearTimeout(timeout);
        reveal(synced);
      },
      (percent) => setSavingProgress(percent)
    );
  };

  const onOpenPdf = async () => {
    let path = pdfPath;
    if (!path || !(await FileSystem.getInfoAsync(path)).exists) {
      try {
        path = await getOrGeneratePdf(record);
        await saveRecord(record);
        setPdfPath(path);
      } catch (e) {
        Alert.alert('Could not generate report', String(e));
        return;
      }
    }
    navigation.navigate('PdfViewer', { pdfPath: path, title: donorFullName(record) });
  };

  const onSendEmail = async () => {
    // No longer gated on testSetup.recipientEmail — that field was removed from Test Setup, and
    // every report currently goes to TEST_RECIPIENT_OVERRIDE regardless (see that constant's own
    // doc). Re-add a recipient check here if/when the override is ever removed.
    setSendingEmail(true);
    let tempPath: string | null = null;
    try {
      tempPath = await generatePdfToTempFile(record);
      await sendReportEmail(record, tempPath, TEST_RECIPIENT_OVERRIDE);
      record.emailSent = true;
      await saveRecord(record);
      showToast('Report emailed successfully', 'success');
    } catch (e) {
      showToast(`Failed to send email: ${(e as Error).message}`, 'error');
    } finally {
      if (tempPath) await FileSystem.deleteAsync(tempPath, { idempotent: true });
      setSendingEmail(false);
    }
  };

  const onBackToHome = async () => {
    allowLeave.current = true;
    await clear();
    navigation.reset({ index: 0, routes: [{ name: 'History' }] });
  };

  if (saved) {
    const fileName = pdfPath ? pdfPath.split('/').pop() : null;
    return (
      <View style={styles.screen}>
        <View style={styles.topBar}>
          <Text style={styles.topBarTitle}>Test Complete</Text>
        </View>
        <ScrollView contentContainerStyle={[styles.savedContainer, { paddingBottom: 24 + insets.bottom }]}>
          <View style={styles.savedIconCircle}>
            <MaterialIcons name="check" size={40} color={colors.white} />
          </View>
          <Text style={styles.savedTitle}>Record Saved</Text>
          <Text style={styles.savedSubtitle}>This test has been completed.</Text>

          <View style={styles.savedInfoCard}>
            <View style={styles.savedInfoRow}>
              <MaterialIcons name="person" size={18} color={colors.textSecondary} style={styles.savedInfoIcon} />
              <Text style={styles.savedInfoText}>{donorFullName(record)}</Text>
            </View>
            <View style={styles.savedInfoDivider} />
            <View style={styles.savedInfoRow}>
              <MaterialIcons name="event" size={18} color={colors.textSecondary} style={styles.savedInfoIcon} />
              <Text style={styles.savedInfoText}>Saved {formatDateTime(record.updatedAt)}</Text>
            </View>
            <View style={styles.savedInfoDivider} />
            <View style={styles.savedInfoRow}>
              <MaterialIcons name="description" size={18} color={colors.textSecondary} style={styles.savedInfoIcon} />
              <Text style={styles.savedInfoText} numberOfLines={1}>
                {fileName ?? 'Report will be generated when you open it'}
              </Text>
            </View>
          </View>

          <Button title="Open PDF" variant="outlined" icon="picture-as-pdf" onPress={onOpenPdf} style={styles.savedButton} />
          {!firebaseAuth.currentUser?.isAnonymous && (
            <>
              <Button
                title={sendingEmail ? 'Sending…' : 'Send Email'}
                icon="email"
                onPress={onSendEmail}
                loading={sendingEmail}
                style={styles.savedButton}
              />
              {sendingEmail && (
                <View style={styles.emailProgressRow}>
                  <ActivityIndicator size="small" color={colors.brandPrimary} />
                  <Text style={styles.emailProgressText}>Sending email…</Text>
                </View>
              )}
            </>
          )}

          <Button title="Back to Home" variant="text" onPress={onBackToHome} style={styles.backToHomeButton} />
        </ScrollView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingScreen>
    <View style={styles.screen}>
      <View style={styles.topBar}>
        <Text style={styles.topBarTitle}>Summary</Text>
      </View>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingBottom: 20 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Report</Text>
        <Text style={styles.instruction}>
          Review everything below before saving. Once saved, you can email, open, or share the PDF report.
        </Text>

        <RecordDetailView record={record} />

        <TextField label="Report file name" value={pdfDisplayName} onChangeText={setPdfDisplayName} style={styles.pdfNameField} />

        {saving && (
          <View style={styles.savingRow}>
            <View style={styles.savingHeader}>
              {savingProgress == null && <ActivityIndicator size="small" color={colors.brandPrimary} />}
              <Text style={styles.savingText}>{savingStatus}</Text>
            </View>
            {savingProgress != null && (
              <>
                <View style={styles.savingProgressTrack}>
                  <View style={[styles.savingProgressFill, { width: `${savingProgress}%` }]} />
                </View>
                <Text style={styles.savingProgressPercent}>{savingProgress}%</Text>
              </>
            )}
          </View>
        )}

        <View style={styles.bottomBar}>
          <Button title="Back" icon="arrow-back" variant="outlined" onPress={() => navigation.goBack()} style={styles.backButton} disabled={saving} />
          <Button title="Save" trailingIcon="check" onPress={onSave} loading={saving} style={styles.nextButton} />
        </View>
      </ScrollView>
    </View>
    </KeyboardAvoidingScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  topBar: {
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 14,
  },
  topBarTitle: { fontSize: 20, fontWeight: '700', color: colors.white },
  container: { padding: 20, backgroundColor: colors.background },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginBottom: 8 },
  instruction: { fontSize: 13, color: colors.textSecondary, marginBottom: 16 },
  pdfNameField: { marginTop: 20 },
  savingRow: { marginTop: 8 },
  savingHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  savingText: { fontSize: 12, color: colors.textSecondary },
  savingProgressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.divider, overflow: 'hidden', marginTop: 8 },
  savingProgressFill: { height: '100%', backgroundColor: colors.brandAccent },
  savingProgressPercent: { textAlign: 'right', fontSize: 12, fontWeight: '700', color: colors.brandPrimary, marginTop: 4 },
  bottomBar: { flexDirection: 'row', gap: 12, marginTop: 12 },
  backButton: { flex: 1 },
  nextButton: { flex: 1 },
  savedContainer: { flexGrow: 1, backgroundColor: colors.background, alignItems: 'center', padding: 24, paddingTop: 40 },
  savedIconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.brandSuccess,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  savedTitle: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginBottom: 6 },
  savedSubtitle: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginBottom: 24, lineHeight: 18 },
  savedInfoCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingVertical: 4,
    marginBottom: 28,
  },
  savedInfoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16 },
  savedInfoIcon: { marginRight: 12 },
  savedInfoText: { fontSize: 14, color: colors.textPrimary, flexShrink: 1 },
  savedInfoDivider: { height: 1, backgroundColor: colors.divider, marginLeft: 46 },
  savedButton: { width: '100%', marginTop: 12 },
  backToHomeButton: { width: '100%', marginTop: 20 },
  emailProgressRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 },
  emailProgressText: { fontSize: 12, color: colors.textSecondary },
});
