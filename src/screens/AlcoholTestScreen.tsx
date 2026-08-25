import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { useWorkflow } from '../hooks/WorkflowContext';
import { MEASUREMENT_UNITS } from '../models/AlcoholTestInfo';
import { isBeforeToday } from '../utils/dateUtils';
import TextField from '../components/TextField';
import SelectField from '../components/SelectField';
import DateField from '../components/DateField';
import RadioGroup, { RadioOption } from '../components/RadioGroup';
import ResultToggle from '../components/ResultToggle';
import PhotoCaptureBox from '../components/PhotoCaptureBox';
import Button from '../components/Button';
import { useToast } from '../components/Toast';
import FormSection from '../components/FormSection';
import WizardHeader from '../components/WizardHeader';
import KeyboardAvoidingScreen from '../components/KeyboardAvoidingScreen';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'AlcoholTest'>;

const YES_NO_OPTIONS: RadioOption<'yes' | 'no'>[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

/**
 * Mirrors AlcoholTestFragment.java's device setup + first test, but with a deliberate change to
 * the second-test flow (per explicit product direction): rather than the second test being a
 * manually-triggered optional add-on, it's now driven directly by the first test's result — a
 * Fail on the first breath test requires a confirmatory second test (15-min-wait question, then
 * date/time + photo + result) before the operator can continue; a Pass skips all of that and
 * proceeds straight to Next. Whatever the second test's own result turns out to be (pass or
 * fail), it doesn't block moving on — only that it was actually recorded.
 */
export default function AlcoholTestScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const { record, updateRecord, saveDraft } = useWorkflow();
  const info = record.alcoholTestInfo;
  const result = record.alcoholResult;

  const [deviceSerial, setDeviceSerial] = useState(info.deviceSerial ?? '');
  const [calibrationExpiry, setCalibrationExpiry] = useState<number | null>(info.calibrationExpiry);
  const [measurementUnit, setMeasurementUnit] = useState<string | null>(info.measurementUnit);
  const [firstTestDateTime, setFirstTestDateTime] = useState<number | null>(info.firstTestDateTime);
  const [photo1, setPhoto1] = useState<string | null>(record.alcoholTestPhotoPath);
  const [firstResult, setFirstResult] = useState<'NEGATIVE' | 'NON_NEGATIVE' | null>(
    result.firstTestResult as 'NEGATIVE' | 'NON_NEGATIVE' | null
  );
  const [waiting15Min, setWaiting15Min] = useState<'yes' | 'no' | null>(
    info.waiting15Min == null ? null : info.waiting15Min ? 'yes' : 'no'
  );
  const [secondTestDateTime, setSecondTestDateTime] = useState<number | null>(info.secondTestDateTime);
  const [photo2, setPhoto2] = useState<string | null>(record.alcoholTestPhotoPath2);
  const [secondResult, setSecondResult] = useState<'NEGATIVE' | 'NON_NEGATIVE' | null>(
    result.secondTestResult as 'NEGATIVE' | 'NON_NEGATIVE' | null
  );

  // The first test failing is what requires a second, confirmatory test — not whether the
  // operator happened to fill in a second date/time (that's just how the requirement gets
  // satisfied). Passing means there's nothing further to record.
  const firstFailed = firstResult === 'NON_NEGATIVE';

  const onFirstResultChange = (value: 'NEGATIVE' | 'NON_NEGATIVE') => {
    setFirstResult(value);
    if (value !== 'NON_NEGATIVE') {
      // Switching back to Pass means the second test no longer applies — drop anything already
      // entered for it so a stale confirmatory test never lingers on a passing record.
      setWaiting15Min(null);
      setSecondTestDateTime(null);
      setPhoto2(null);
      setSecondResult(null);
    }
  };

  const warnIfExpired = (millis: number) => {
    if (!isBeforeToday(millis)) return;
    Alert.alert('Expired', 'The test kit is expired. Are you sure?', [
      { text: 'No', style: 'cancel', onPress: () => setCalibrationExpiry(null) },
      { text: 'Yes', style: 'default' },
    ]);
  };

  const onCalibrationExpiryChange = (millis: number) => {
    setCalibrationExpiry(millis);
    warnIfExpired(millis);
  };

  const onSecondTestDateTimeChange = (millis: number) => {
    if (firstTestDateTime != null && millis <= firstTestDateTime) {
      showToast('Second test time must be after the first test', 'error');
      return;
    }
    setSecondTestDateTime(millis);
  };

  const persistCommon = () => {
    updateRecord((r) => {
      r.alcoholTestInfo.deviceSerial = deviceSerial.trim();
      r.alcoholTestInfo.measurementUnit = measurementUnit;
      r.alcoholTestInfo.calibrationExpiry = calibrationExpiry;
      r.alcoholTestInfo.firstTestDateTime = firstTestDateTime;
      r.alcoholTestInfo.waiting15Min = firstFailed && waiting15Min != null ? waiting15Min === 'yes' : null;
      r.alcoholTestInfo.secondTestDateTime = firstFailed ? secondTestDateTime : null;
      r.alcoholResult.firstTestResult = firstResult;
      r.alcoholResult.secondTestResult = firstFailed ? secondResult : null;
      r.alcoholTestPhotoPath = photo1;
      r.alcoholTestPhotoPath2 = firstFailed ? photo2 : null;
    });
  };

  const onPhoto1Captured = async (uri: string) => {
    setPhoto1(uri);
    persistCommon();
    updateRecord((r) => {
      r.alcoholTestPhotoPath = uri;
    });
    await saveDraft();
  };

  const onPhoto2Captured = async (uri: string) => {
    setPhoto2(uri);
    persistCommon();
    updateRecord((r) => {
      r.alcoholTestPhotoPath2 = uri;
    });
    await saveDraft();
  };

  const base =
    deviceSerial.trim() !== '' &&
    calibrationExpiry != null &&
    !!measurementUnit &&
    firstTestDateTime != null &&
    !!photo1 &&
    !!firstResult;
  // Once the first test fails, the confirmatory second test must actually be recorded — but its
  // own result (pass or fail) never blocks moving on, only that one was given.
  const secondTestOk = !firstFailed || (secondTestDateTime != null && !!photo2 && !!secondResult);
  const canProceed = base && secondTestOk;

  const onNext = async () => {
    persistCommon();
    await saveDraft();
    navigation.navigate('FinalSignOff');
  };

  // Persists whatever's currently filled in regardless of validity — used on Back so a
  // Back-then-forward round trip never wipes what was just entered.
  const onBack = async () => {
    persistCommon();
    await saveDraft();
    navigation.goBack();
  };

  return (
    <KeyboardAvoidingScreen>
    <ScrollView
      contentContainerStyle={[styles.container, { paddingBottom: 20 + insets.bottom }]}
      keyboardShouldPersistTaps="handled"
    >
      <WizardHeader title="Alcohol Test" step={7} />

      <FormSection title="Device">
        <TextField label="Device Serial # *" value={deviceSerial} onChangeText={setDeviceSerial} startIcon="devices" />
        <DateField label="Calibration Expiry *" value={calibrationExpiry} onChange={onCalibrationExpiryChange} />
        <SelectField
          label="Measurement unit *"
          value={measurementUnit}
          options={MEASUREMENT_UNITS}
          onChange={setMeasurementUnit}
        />
      </FormSection>

      <FormSection title="First Test">
        <DateField
          label="First test date & time *"
          value={firstTestDateTime}
          onChange={setFirstTestDateTime}
          mode="datetime"
        />
        <PhotoCaptureBox photoPath={photo1} onCaptured={onPhoto1Captured} recordId={record.id} filePrefix="alcohol_test_photo_1" />
        <Text style={styles.fieldLabel}>First test result *</Text>
        <ResultToggle value={firstResult} onChange={onFirstResultChange} negativeLabel="Pass" nonNegativeLabel="Fail" />

        {firstFailed && (
          <>
            <Text style={styles.fieldLabel}>15 min waiting time</Text>
            <RadioGroup options={YES_NO_OPTIONS} value={waiting15Min} onChange={setWaiting15Min} horizontal />
          </>
        )}
      </FormSection>

      {firstFailed && (
        <FormSection title="Second Test">
          <DateField
            label="Second test date & time *"
            value={secondTestDateTime}
            onChange={onSecondTestDateTimeChange}
            mode="datetime"
            minDate={firstTestDateTime ? new Date(firstTestDateTime) : undefined}
          />
          <PhotoCaptureBox photoPath={photo2} onCaptured={onPhoto2Captured} recordId={record.id} filePrefix="alcohol_test_photo_2" />
          <Text style={styles.fieldLabel}>Second test result *</Text>
          <ResultToggle value={secondResult} onChange={setSecondResult} negativeLabel="Pass" nonNegativeLabel="Fail" />
        </FormSection>
      )}

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
  sectionLabel: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginTop: 20, marginBottom: 8 },
  fieldLabel: { fontSize: 13, color: colors.textSecondary, marginTop: 12, marginBottom: 4 },
  bottomBar: { flexDirection: 'row', gap: 12, marginTop: 24 },
  backButton: { flex: 1 },
  nextButton: { flex: 1 },
});
