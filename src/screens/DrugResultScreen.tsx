import React, { useRef, useState } from 'react';
import { View, Text, Image, ScrollView, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { useWorkflow } from '../hooks/WorkflowContext';
import { SUBSTANCES, CONTROL_LINE_KEY } from '../models/DrugResult';
import { ResultValue } from '../models/ResultValue';
import ResultToggle from '../components/ResultToggle';
import SignaturePad, { SignaturePadHandle } from '../components/SignaturePad';
import Button from '../components/Button';
import FormSection from '../components/FormSection';
import WizardHeader from '../components/WizardHeader';
import { newMediaFilePath } from '../services/fileStorage';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'DrugResult'>;
type NegOrNonNeg = 'NEGATIVE' | 'NON_NEGATIVE';

const REAL_SUBSTANCES = SUBSTANCES.filter((s) => s !== CONTROL_LINE_KEY);

/** Mirrors DrugResultFragment.java. */
export default function DrugResultScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { record, updateRecord, saveDraft } = useWorkflow();
  const result = record.drugResult;

  const [overall, setOverall] = useState<NegOrNonNeg | null>(result.overallResult as NegOrNonNeg | null);
  const [substances, setSubstances] = useState<Record<string, NegOrNonNeg>>(
    { ...result.substanceResults } as Record<string, NegOrNonNeg>
  );
  const [autoDetected, setAutoDetected] = useState(result.autoDetected);
  const [confirmationVisible, setConfirmationVisible] = useState(!!result.confirmationSignaturePath);
  const [hasSignature, setHasSignature] = useState(!!result.confirmationSignaturePath);
  const [scrollEnabled, setScrollEnabled] = useState(true);

  const signatureRef = useRef<SignaturePadHandle>(null);

  const clearAutoDetected = () => {
    if (autoDetected) setAutoDetected(false);
  };

  const isContradictory = () => {
    if (overall !== 'NON_NEGATIVE') return false;
    return REAL_SUBSTANCES.every((s) => substances[s] !== 'NON_NEGATIVE');
  };

  const resultsValid = () => {
    if (overall == null) return false;
    if (overall === 'NEGATIVE') return true;
    return REAL_SUBSTANCES.every((s) => substances[s] != null);
  };

  const canProceed = resultsValid() && (!confirmationVisible || hasSignature);

  const saveIntoRecord = async () => {
    updateRecord((r) => {
      r.drugResult.overallResult = overall;
      r.drugResult.substanceResults = {};
      if (overall === 'NON_NEGATIVE') {
        const map: Record<string, string> = {};
        for (const s of REAL_SUBSTANCES) {
          map[s] = substances[s] === 'NON_NEGATIVE' ? ResultValue.NON_NEGATIVE : ResultValue.NEGATIVE;
        }
        map[CONTROL_LINE_KEY] = ResultValue.NEGATIVE;
        r.drugResult.substanceResults = map;
      }
    });

    // signatureRef.current is null until confirmationVisible mounts the pad — e.g. Back pressed
    // before ever reaching the confirmation step — in which case there's nothing to persist or
    // clear here at all.
    if (signatureRef.current) {
      if (signatureRef.current.isEmpty()) {
        updateRecord((r) => {
          r.drugResult.confirmationSignaturePath = null;
        });
      } else if (signatureRef.current.hasUnsavedChanges()) {
        const path = result.confirmationSignaturePath ?? (await newMediaFilePath(record.id, 'drug_result_confirmation_signature'));
        await signatureRef.current.saveToFile(path);
        updateRecord((r) => {
          r.drugResult.confirmationSignaturePath = path;
        });
      }
    }
  };

  const onNext = async () => {
    if (isContradictory()) {
      Alert.alert(
        'Check the results again',
        'You marked the overall result as Non-Negative, but every individual substance is marked Negative. Please review the substance panel again before continuing.'
      );
      return;
    }
    if (!confirmationVisible) {
      Alert.alert(
        'Result Confirmation',
        'Please confirm that the results match with your visual inspection',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Confirm', onPress: () => setConfirmationVisible(true) },
        ]
      );
      return;
    }
    await saveIntoRecord();
    await saveDraft();
    navigation.navigate('AlcoholTest');
  };

  // Persists whatever's currently selected regardless of validity — used on Back so a
  // Back-then-forward round trip never wipes the results/signature just entered (previously Back
  // skipped persisting entirely).
  const onBack = async () => {
    await saveIntoRecord();
    await saveDraft();
    navigation.goBack();
  };

  return (
    <ScrollView
      contentContainerStyle={[styles.container, { paddingBottom: 20 + insets.bottom }]}
      scrollEnabled={scrollEnabled}
    >
      <WizardHeader title="Drug Test Result" step={6} />

      {record.drugTestPhotoPath && (
        <View style={styles.photoCard}>
          <Image source={{ uri: record.drugTestPhotoPath }} style={styles.photo} resizeMode="contain" />
        </View>
      )}

      {autoDetected && (
        <Text style={styles.autoDetectedNotice}>
          Result auto-detected from the photo — please verify against the cassette before continuing
        </Text>
      )}

      <FormSection title="Overall Result *">
        <ResultToggle
          value={overall}
          onChange={(v) => {
            setOverall(v);
            clearAutoDetected();
          }}
        />

        {overall === 'NON_NEGATIVE' && (
          <View style={styles.substanceCard}>
            {REAL_SUBSTANCES.map((substance, index) => (
              <View key={substance} style={[styles.substanceRow, index > 0 && styles.substanceRowDivider]}>
                <Text style={styles.substanceLabel}>{substance}</Text>
                <ResultToggle
                  size="small"
                  value={substances[substance] ?? null}
                  onChange={(v) => {
                    setSubstances((prev) => ({ ...prev, [substance]: v }));
                    clearAutoDetected();
                  }}
                />
              </View>
            ))}
          </View>
        )}
      </FormSection>

      {confirmationVisible && (
        <FormSection title="Operator confirmation signature *">
          <SignaturePad
            ref={signatureRef}
            initialFilePath={result.confirmationSignaturePath}
            onChanged={setHasSignature}
            onDrawStateChange={(drawing) => setScrollEnabled(!drawing)}
          />
          <Button
            title="Clear Signature"
            variant="text"
            onPress={() => signatureRef.current?.clear()}
            style={styles.clearSignatureButton}
          />
        </FormSection>
      )}

      <View style={styles.bottomBar}>
        <Button title="Back" icon="arrow-back" variant="outlined" onPress={onBack} style={styles.backButton} />
        <Button title="Next" trailingIcon="arrow-forward" onPress={onNext} disabled={!canProceed} style={styles.nextButton} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: colors.background },
  photoCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    marginBottom: 16,
  },
  photo: { width: '100%', height: 220 },
  autoDetectedNotice: { fontSize: 12, color: colors.brandAccent, marginBottom: 16 },
  sectionLabel: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginTop: 20, marginBottom: 8 },
  substanceCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  substanceRow: {
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  substanceRowDivider: { borderTopWidth: 1, borderTopColor: colors.divider },
  substanceLabel: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: 8 },
  clearSignatureButton: { alignSelf: 'flex-start', marginTop: 4 },
  bottomBar: { flexDirection: 'row', gap: 12, marginTop: 24 },
  backButton: { flex: 1 },
  nextButton: { flex: 1 },
});
