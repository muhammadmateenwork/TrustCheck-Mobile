import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { useWorkflow } from '../hooks/WorkflowContext';
import { parseQrCode } from '../utils/qrCodeParser';
import { formatDate, isBeforeToday } from '../utils/dateUtils';
import TextField from '../components/TextField';
import DateField from '../components/DateField';
import Button from '../components/Button';
import { useToast } from '../components/Toast';
import FormSection from '../components/FormSection';
import KeyboardAvoidingScreen from '../components/KeyboardAvoidingScreen';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'TestKit'>;

/** Mirrors TestKitInfoFragment.java. */
export default function TestKitScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const { record, updateRecord, saveDraft } = useWorkflow();
  const info = record.testKitInfo;

  const [partNo, setPartNo] = useState(info.partNo ?? '');
  const [lotNo, setLotNo] = useState(info.lotNo ?? '');
  const [expiryDate, setExpiryDate] = useState<number | null>(info.expiryDate);
  const [expiryDayKnown, setExpiryDayKnown] = useState(info.expiryDayKnown);
  const [scannedFromQr, setScannedFromQr] = useState(info.scannedFromQr);
  const [rawQrData, setRawQrData] = useState<string | null>(info.rawQrData);

  const lastHandledScan = useRef<number | undefined>(undefined);

  useEffect(() => {
    const scannedAt = route.params?.scannedAt;
    const raw = route.params?.scannedQrRaw;
    if (!scannedAt || !raw || lastHandledScan.current === scannedAt) return;
    lastHandledScan.current = scannedAt;
    applyScannedData(raw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.scannedAt]);

  const applyScannedData = (raw: string) => {
    if (!raw.trim()) {
      showToast('QR code did not contain readable data', 'error');
      return;
    }
    const parsed = parseQrCode(raw);
    setRawQrData(parsed.rawQrData);
    setScannedFromQr(true);
    if (parsed.partNo) setPartNo(parsed.partNo);
    if (parsed.lotNo) setLotNo(parsed.lotNo);
    if (parsed.expiryDate != null) {
      setExpiryDate(parsed.expiryDate);
      setExpiryDayKnown(parsed.expiryDayKnown);
      warnIfExpired(parsed.expiryDate);
    }
    showToast('Fields pre-filled from QR code. Please verify before continuing.', 'info');
  };

  const warnIfExpired = (expiryMillis: number) => {
    if (!isBeforeToday(expiryMillis)) return;
    Alert.alert('Expired', 'The test kit is expired. Are you sure?', [
      {
        text: 'No',
        style: 'cancel',
        onPress: () => setExpiryDate(null),
      },
      { text: 'Yes', style: 'default' },
    ]);
  };

  const onExpiryChange = (millis: number) => {
    setExpiryDate(millis);
    setExpiryDayKnown(true); // manually picked, so the exact day is now known
    warnIfExpired(millis);
  };

  const canProceed = partNo.trim() !== '' && lotNo.trim() !== '' && expiryDate != null;

  const onScanQr = async () => {
    // Same reasoning as every other camera hand-off in the wizard: backgrounding for the camera
    // is the highest-risk moment for the OS to reclaim this process, so whatever's already been
    // typed here needs to be on disk before that handoff, not just in memory.
    updateRecord((r) => {
      r.testKitInfo.partNo = partNo.trim();
      r.testKitInfo.lotNo = lotNo.trim();
    });
    await saveDraft();
    navigation.navigate('QrScan');
  };

  // Persists whatever's currently filled in regardless of validity — used on both Next and Back
  // so a Back-then-forward round trip never wipes what was just entered.
  const persist = async () => {
    updateRecord((r) => {
      r.testKitInfo.partNo = partNo.trim();
      r.testKitInfo.lotNo = lotNo.trim();
      r.testKitInfo.expiryDate = expiryDate;
      r.testKitInfo.expiryDayKnown = expiryDayKnown;
      r.testKitInfo.scannedFromQr = scannedFromQr;
      r.testKitInfo.rawQrData = rawQrData;
    });
    await saveDraft();
  };

  const onNext = async () => {
    await persist();
    navigation.navigate('DrugTestPicture');
  };

  const onBack = async () => {
    await persist();
    navigation.goBack();
  };

  return (
    <KeyboardAvoidingScreen>
    <ScrollView
      contentContainerStyle={[styles.container, { paddingBottom: 20 + insets.bottom }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Test Kit Information</Text>

      {scannedFromQr && (
        <Text style={styles.qrNotice}>Fields pre-filled from QR code. Please verify before continuing.</Text>
      )}
      {scannedFromQr && rawQrData && (
        <Pressable onPress={() => Alert.alert('Scanned QR Data', rawQrData || '(empty)')}>
          <Text style={styles.viewRawLink}>View scanned QR data</Text>
        </Pressable>
      )}

      <FormSection>
        <TextField label="Part No. *" value={partNo} onChangeText={setPartNo} startIcon="inventory-2" />
        <TextField label="LOT No. *" value={lotNo} onChangeText={setLotNo} startIcon="sell" />
        <DateField label="Expiry Date *" value={expiryDate} onChange={onExpiryChange} />
        {expiryDate != null && !expiryDayKnown && (
          <Text style={styles.dayUnknownNote}>Only month/year was scanned — showing {formatDate(expiryDate, false)}</Text>
        )}

        <Button title="Scan QR Code" icon="qr-code-scanner" variant="outlined" onPress={onScanQr} style={styles.scanButton} />
      </FormSection>

      <View style={styles.bottomBar}>
        <Button title="Back" icon="arrow-back" variant="outlined" onPress={onBack} style={styles.backButton} />
        <Button title="Next" trailingIcon="arrow-forward" onPress={onNext} disabled={!canProceed} style={styles.nextButton} />
      </View>
    </ScrollView>
    </KeyboardAvoidingScreen>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: colors.background },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginBottom: 16 },
  qrNotice: { fontSize: 12, color: colors.brandAccent, marginBottom: 4 },
  viewRawLink: { fontSize: 12, color: colors.brandAccent, textDecorationLine: 'underline', marginBottom: 16 },
  dayUnknownNote: { fontSize: 11, color: colors.textSecondary, marginTop: -10, marginBottom: 12 },
  scanButton: { marginTop: 8, marginBottom: 8 },
  bottomBar: { flexDirection: 'row', gap: 12, marginTop: 24 },
  backButton: { flex: 1 },
  nextButton: { flex: 1 },
});
