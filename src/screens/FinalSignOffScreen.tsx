import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { useWorkflow } from '../hooks/WorkflowContext';
import SignaturePad, { SignaturePadHandle } from '../components/SignaturePad';
import Button from '../components/Button';
import FormSection from '../components/FormSection';
import { newMediaFilePath } from '../services/fileStorage';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'FinalSignOff'>;

/** Mirrors FinalSignOffFragment.java. The operator name shown here is just a re-display of what
 *  was already captured and confirmed on Operator Consent — not editable, not collected again. */
export default function FinalSignOffScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { record, updateRecord, saveDraft } = useWorkflow();
  const signOff = record.finalSignOff;
  const operatorName = record.operatorConsent.operatorName;

  const [hasSignature, setHasSignature] = useState(!!signOff.signaturePath);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const signatureRef = useRef<SignaturePadHandle>(null);

  // Persists the signature (if any) regardless of completeness — shared by Finish and Back so a
  // Back-then-forward round trip never wipes what was just signed.
  const persist = async () => {
    if (signatureRef.current) {
      if (signatureRef.current.isEmpty()) {
        updateRecord((r) => {
          r.finalSignOff.operatorName = operatorName;
          r.finalSignOff.signaturePath = null;
        });
      } else if (signatureRef.current.hasUnsavedChanges()) {
        const path = signOff.signaturePath ?? (await newMediaFilePath(record.id, 'final_signoff_signature'));
        await signatureRef.current.saveToFile(path);
        updateRecord((r) => {
          r.finalSignOff.operatorName = operatorName;
          r.finalSignOff.signaturePath = path;
        });
      }
    }
    await saveDraft();
  };

  const onFinish = async () => {
    await persist();
    navigation.navigate('Summary');
  };

  const onBack = async () => {
    await persist();
    navigation.goBack();
  };

  return (
    <ScrollView
      contentContainerStyle={[styles.container, { paddingBottom: 20 + insets.bottom }]}
      scrollEnabled={scrollEnabled}
    >
      <Text style={styles.title}>Final Sign-off</Text>

      <FormSection>
        <Text style={styles.fieldLabel}>Operator</Text>
        <Text style={styles.operatorName}>{operatorName || '-'}</Text>
      </FormSection>

      <FormSection title="Signature *">
        <SignaturePad
          ref={signatureRef}
          initialFilePath={signOff.signaturePath}
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

      <View style={styles.bottomBar}>
        <Button title="Back" icon="arrow-back" variant="outlined" onPress={onBack} style={styles.backButton} />
        <Button title="Finish" trailingIcon="check" onPress={onFinish} disabled={!hasSignature} style={styles.nextButton} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: colors.background },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginBottom: 16 },
  fieldLabel: { fontSize: 13, color: colors.textSecondary, marginBottom: 4 },
  operatorName: { fontSize: 16, fontWeight: '600', color: colors.textPrimary, marginBottom: 8 },
  sectionLabel: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginTop: 20, marginBottom: 8 },
  clearSignatureButton: { alignSelf: 'flex-start', marginTop: 4 },
  bottomBar: { flexDirection: 'row', gap: 12, marginTop: 24 },
  backButton: { flex: 1 },
  nextButton: { flex: 1 },
});
