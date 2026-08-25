import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { useWorkflow } from '../hooks/WorkflowContext';
import { REASON_FOR_TEST_OPTIONS } from '../models/TestSetup';
import TextField from '../components/TextField';
import SelectField from '../components/SelectField';
import Button from '../components/Button';
import FormSection from '../components/FormSection';
import KeyboardAvoidingScreen from '../components/KeyboardAvoidingScreen';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'TestSetup'>;

/** Mirrors TestSetupFragment.java. */
export default function TestSetupScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { record, updateRecord, saveDraft } = useWorkflow();
  const setup = record.testSetup;

  const [company, setCompany] = useState(setup.company ?? '');
  const [testingSite, setTestingSite] = useState(setup.testingSite ?? '');
  const [reasonForTest, setReasonForTest] = useState<string | null>(setup.reasonForTest);
  const [supervisor, setSupervisor] = useState(setup.supervisorOnSite ?? '');
  const [supportPerson, setSupportPerson] = useState(setup.supportPerson ?? '');
  const [resultRecipient, setResultRecipient] = useState(setup.resultRecipient ?? '');

  const canProceed =
    company.trim() !== '' &&
    testingSite.trim() !== '' &&
    !!reasonForTest &&
    resultRecipient.trim() !== '';

  // Persists whatever's currently in the fields regardless of validity — used on both Next and
  // Back, so leaving this screen either direction never silently drops what the operator typed
  // (previously Back skipped this entirely, so a Back-then-forward round trip wiped the screen).
  const persist = async () => {
    updateRecord((r) => {
      r.testSetup.company = company.trim();
      r.testSetup.testingSite = testingSite.trim();
      r.testSetup.reasonForTest = reasonForTest;
      r.testSetup.supervisorOnSite = supervisor.trim();
      r.testSetup.supportPerson = supportPerson.trim();
      r.testSetup.resultRecipient = resultRecipient.trim();
    });
    await saveDraft();
  };

  const onNext = async () => {
    await persist();
    navigation.navigate('OperatorConsent');
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
      <Text style={styles.title}>Test Setup</Text>

      <FormSection>
        <TextField label="Company *" value={company} onChangeText={setCompany} startIcon="business" />
        <TextField label="Testing Site *" value={testingSite} onChangeText={setTestingSite} startIcon="location-on" />
        <SelectField
          label="Reason For Test *"
          value={reasonForTest}
          options={REASON_FOR_TEST_OPTIONS}
          onChange={setReasonForTest}
        />
        <TextField label="Supervisor on Site" value={supervisor} onChangeText={setSupervisor} startIcon="supervisor-account" />
        <TextField label="Support Person" value={supportPerson} onChangeText={setSupportPerson} startIcon="support-agent" />
        <TextField label="Result Recipient *" value={resultRecipient} onChangeText={setResultRecipient} startIcon="person" />
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
  bottomBar: { flexDirection: 'row', gap: 12, marginTop: 12 },
  backButton: { flex: 1 },
  nextButton: { flex: 1 },
});
