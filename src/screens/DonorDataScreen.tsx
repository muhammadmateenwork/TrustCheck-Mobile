import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { useWorkflow } from '../hooks/WorkflowContext';
import TextField from '../components/TextField';
import DateField from '../components/DateField';
import Checkbox from '../components/Checkbox';
import RadioGroup from '../components/RadioGroup';
import SignaturePad, { SignaturePadHandle } from '../components/SignaturePad';
import PhotoCaptureBox from '../components/PhotoCaptureBox';
import Button from '../components/Button';
import FormSection from '../components/FormSection';
import WizardHeader from '../components/WizardHeader';
import KeyboardAvoidingScreen from '../components/KeyboardAvoidingScreen';
import { newMediaFilePath } from '../services/fileStorage';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'DonorData'>;

const INITIAL_CONSENT_TEXT =
  'The drug and alcohol test procedure will be carried out by a qualified person and has been ' +
  'explained to me and I consent to collection and on-site initial screen which will be conducted ' +
  'in accordance with relevant international standards, workplace policy and NZ Law. I understand ' +
  'the consequences of a not negative onsite result. When required my specimen(s) will be processed ' +
  'in my presence to transport to an accredited Laboratory for Drug and/or Alcohol testing.';

const DECLARATIONS = [
  'I declare that the specimen provided by me to the authorised Collector for the purpose of this Drug and or alcohol test is my own.',
  'I declare that any on-site Drug and/or alcohol screen test performed was carried out in my presence.',
  'I declare that the information provided on this form is correct and I consent to the release of all test results together with relevant details on this form to the nominated authority indicated above.',
  'I declare that if required ,I further consent to, appropriate specimen(s) collected and/or processed in my presence that will be transported to an accredited Laboratory for the purpose of drug confirmation in compliance with relevant NZ Standards.',
];

/**
 * Mirrors DonorDataFragment.java — the wizard's actual entry point. Re-entering the wizard fresh
 * (from History's "+ New Test") always starts a genuinely new record via useWorkflow().startNew(),
 * called by HistoryScreen right before navigating here — matches the native app's
 * hasActiveRecord()/isRecordAlreadyCompleted() guard, just moved to the point of navigation
 * instead of re-checked here, since React Navigation doesn't re-run this screen's mount logic the
 * way Fragment re-entry does.
 */
export default function DonorDataScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { record, updateRecord, saveDraft } = useWorkflow();
  const donor = record.donor;

  const [testNumber, setTestNumber] = useState(donor.testNumber ?? '');
  const [donorId, setDonorId] = useState(donor.donorId ?? '');
  const [firstName, setFirstName] = useState(donor.firstName ?? '');
  const [surname, setSurname] = useState(donor.surname ?? '');
  const [dob, setDob] = useState<number | null>(donor.dateOfBirth);
  const [medication, setMedication] = useState<'yes' | 'no' | null>(
    donor.medicationLast7Days == null ? null : donor.medicationLast7Days ? 'yes' : 'no'
  );
  const [medicationDetails, setMedicationDetails] = useState(donor.medicationDetails ?? '');
  const [initialConsent, setInitialConsent] = useState(donor.initialConsentAgreed);
  const [decl1, setDecl1] = useState(donor.declarationAgreed);
  const [decl2, setDecl2] = useState(donor.declarationAgreed);
  const [decl3, setDecl3] = useState(donor.declarationAgreed);
  const [decl4, setDecl4] = useState(donor.declarationAgreed);
  const [hasSignature, setHasSignature] = useState(!!donor.signaturePath);
  const [idPhotoUri, setIdPhotoUri] = useState<string | null>(donor.idPhotoPath);
  const [scrollEnabled, setScrollEnabled] = useState(true);

  const signatureRef = useRef<SignaturePadHandle>(null);

  const base =
    testNumber.trim() !== '' &&
    donorId.trim() !== '' &&
    firstName.trim() !== '' &&
    surname.trim() !== '' &&
    dob != null &&
    medication != null &&
    initialConsent &&
    decl1 && decl2 && decl3 && decl4 &&
    hasSignature;
  const medicationOk = medication !== 'yes' || medicationDetails.trim() !== '';
  const canProceed = base && medicationOk;

  const persist = async (): Promise<void> => {
    updateRecord((r) => {
      r.donor.testNumber = testNumber.trim();
      r.donor.donorId = donorId.trim();
      r.donor.firstName = firstName.trim();
      r.donor.surname = surname.trim();
      r.donor.dateOfBirth = dob;
      if (medication != null) {
        r.donor.medicationLast7Days = medication === 'yes';
        r.donor.medicationDetails = medication === 'yes' ? medicationDetails.trim() : null;
      }
      r.donor.initialConsentAgreed = initialConsent;
      r.donor.declarationAgreed = decl1 && decl2 && decl3 && decl4;
    });

    if (signatureRef.current) {
      if (signatureRef.current.isEmpty()) {
        updateRecord((r) => {
          r.donor.signaturePath = null;
        });
      } else if (signatureRef.current.hasUnsavedChanges()) {
        const path = record.donor.signaturePath ?? (await newMediaFilePath(record.id, 'donor_signature'));
        await signatureRef.current.saveToFile(path);
        updateRecord((r) => {
          r.donor.signaturePath = path;
        });
      }
    }
  };

  const onNext = async () => {
    await persist();
    await saveDraft();
    navigation.navigate('TestSetup');
  };

  const onIdPhotoCaptured = async (uri: string) => {
    setIdPhotoUri(uri);
    updateRecord((r) => {
      r.donor.idPhotoPath = uri;
    });
    // A photo capture just handed off to the system camera app and back — exactly the kind of
    // backgrounding that risks the OS killing this process. Save now so a kill right after
    // returning here doesn't silently drop the photo that was just taken.
    await persist();
    await saveDraft();
  };

  return (
    <KeyboardAvoidingScreen
      contentContainerStyle={[styles.container, { paddingBottom: 20 + insets.bottom }]}
      scrollEnabled={scrollEnabled}
      keyboardShouldPersistTaps="handled"
    >
      <WizardHeader title="Donor Data" step={1} />

      <FormSection title="Initial Consent">
        <Text style={styles.bodyText}>{INITIAL_CONSENT_TEXT}</Text>
        <Checkbox checked={initialConsent} onChange={setInitialConsent} label="Informed consent conducted and understood *" />
      </FormSection>

      <FormSection title="Donor Details">
        <TextField label="Test # (e.g. DT 5000) *" value={testNumber} onChangeText={setTestNumber} startIcon="confirmation-number" />
        <TextField label="Donor ID *" value={donorId} onChangeText={setDonorId} startIcon="badge" />

        <Text style={styles.sectionLabel}>Photo of Donor ID</Text>
        <PhotoCaptureBox
          photoPath={idPhotoUri}
          onCaptured={onIdPhotoCaptured}
          recordId={record.id}
          filePrefix="donor_id_photo"
        />

        <TextField label="Name *" value={firstName} onChangeText={setFirstName} startIcon="person" />
        <TextField label="Surname *" value={surname} onChangeText={setSurname} startIcon="person-outline" />
        <DateField label="Date of Birth *" value={dob} onChange={setDob} maxDate={new Date()} />
      </FormSection>

      <FormSection title="Medication Declared *">
        <RadioGroup
          options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
          value={medication}
          onChange={setMedication}
          horizontal
        />
        {medication === 'yes' && (
          <TextField label="Medication details" value={medicationDetails} onChangeText={setMedicationDetails} multiline style={styles.medicationField} />
        )}
      </FormSection>

      <FormSection title="Declaration">
        <Checkbox checked={decl1} onChange={setDecl1} label={DECLARATIONS[0]} />
        <Checkbox checked={decl2} onChange={setDecl2} label={DECLARATIONS[1]} />
        <Checkbox checked={decl3} onChange={setDecl3} label={DECLARATIONS[2]} />
        <Checkbox checked={decl4} onChange={setDecl4} label={DECLARATIONS[3]} />
      </FormSection>

      <FormSection title="Donor confirmation signature *">
        <SignaturePad
          ref={signatureRef}
          initialFilePath={donor.signaturePath}
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
        <Button title="Next" trailingIcon="arrow-forward" onPress={onNext} disabled={!canProceed} />
      </View>
    </KeyboardAvoidingScreen>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: colors.background },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginTop: 12, marginBottom: 8 },
  bodyText: { fontSize: 12, color: colors.textSecondary, marginBottom: 8, lineHeight: 18 },
  medicationField: { marginTop: 4 },
  clearSignatureButton: { alignSelf: 'flex-start', marginTop: 4 },
  bottomBar: { marginTop: 8 },
});
