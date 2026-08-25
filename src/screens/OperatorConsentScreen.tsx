import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { useWorkflow } from '../hooks/WorkflowContext';
import { firebaseAuth } from '../services/firebase';
import { fetchOperatorProfile, saveOperatorProfile } from '../services/operatorProfileRepository';
import { OperatorProfile } from '../models/OperatorProfile';
import TextField from '../components/TextField';
import RadioGroup from '../components/RadioGroup';
import Checkbox from '../components/Checkbox';
import SignaturePad, { SignaturePadHandle } from '../components/SignaturePad';
import Button from '../components/Button';
import FormSection from '../components/FormSection';
import WizardHeader from '../components/WizardHeader';
import KeyboardAvoidingScreen from '../components/KeyboardAvoidingScreen';
import { newMediaFilePath } from '../services/fileStorage';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'OperatorConsent'>;

const COLLECTOR_DECLARATION_TEXT =
  'I declare that I witnessed the Test Subject/Employee signature and the specimen identified ' +
  'with this form was provided to me by the Test Subject/Employee whose informed consent was ' +
  'obtained and whose declaration appears above and for whom I obtained identity verification. ' +
  'Furthermore I declare the specimen collection, and on-site drug or alcohol screening was ' +
  'performed in accordance with relevant Standards or procedures detailed in the Workplace Health ' +
  'and Safety Manual/Policy of the requesting company.';

/**
 * Mirrors OperatorConsentFragment.java, with one deliberate change: the underlying field is
 * still `qualificationAvailable` (see OperatorConsent.ts's own doc for why — keeps records
 * cross-readable with the native app), but this screen labels it "NZQA qualified?" with Yes/No
 * options instead of the native "Qualification available?" / "NZ Qualified" / "Not NZ Qualified"
 * wording. The blocking behavior on a "No" answer is unchanged — only "Yes" ever lets the
 * operator proceed.
 */
export default function OperatorConsentScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { record, updateRecord, saveDraft } = useWorkflow();
  const consent = record.operatorConsent;

  const [operatorName, setOperatorName] = useState(consent.operatorName ?? '');
  const [operatorId, setOperatorId] = useState(consent.operatorId ?? '');
  const [qualified, setQualified] = useState<'yes' | 'no' | null>(
    consent.qualificationAvailable == null ? null : consent.qualificationAvailable ? 'yes' : 'no'
  );
  const [agreed, setAgreed] = useState(consent.agreedNoDataMisuse);
  const [hasSignature, setHasSignature] = useState(!!consent.signaturePath);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const [scrollEnabled, setScrollEnabled] = useState(true);

  const signatureRef = useRef<SignaturePadHandle>(null);
  // Suppresses re-applying a slower cloud-profile callback over an edit the operator already
  // made in between — see maybeLoadCloudProfile's own doc.
  const userEditedFields = useRef(false);
  // Phone number is no longer collected on this screen, but the operator's cloud profile
  // document still has its own phoneNumber field (settable from My Profile) — this just carries
  // forward whatever that already was so onNext's profile save doesn't blank it out. Never shown
  // or edited here.
  const existingPhoneNumber = useRef<string | null>(consent.phoneNumber ?? null);

  useEffect(() => {
    void maybeLoadCloudProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Signed-in operators get their saved profile pulled from Firestore and pre-filled — they
   *  only need to review it and sign. Operators who skipped login get no prefill from anywhere,
   *  local or cloud, and nothing they type here is saved anywhere once this test is done. */
  const maybeLoadCloudProfile = async () => {
    const user = firebaseAuth.currentUser;
    if (!user || user.isAnonymous || consent.operatorName != null) return;

    setProfileNotice('Loading your saved profile…');
    await fetchOperatorProfile(
      user.uid,
      (profile) => {
        if (!profile) {
          setProfileNotice(null);
          return;
        }
        if (userEditedFields.current) {
          setProfileNotice(null);
          return;
        }
        setOperatorName(profile.operatorName ?? '');
        setOperatorId(profile.operatorId ?? '');
        existingPhoneNumber.current = profile.phoneNumber ?? null;
        setQualified(profile.qualificationAvailable == null ? null : profile.qualificationAvailable ? 'yes' : 'no');
        setProfileNotice('Loaded your saved profile');
      },
      () => setProfileNotice(null)
    );
  };

  const onQualifiedChange = (value: 'yes' | 'no') => {
    userEditedFields.current = true;
    setQualified(value);
    if (value === 'no') {
      Alert.alert('Cannot proceed', 'This test cannot proceed unless the operator is NZQA qualified.');
    }
  };

  // "No" isn't just "unanswered" — it's an explicit answer that blocks the test outright, so
  // only "Yes" counts as satisfying this requirement, unlike every other field on this screen.
  const canProceed =
    agreed &&
    operatorName.trim() !== '' &&
    operatorId.trim() !== '' &&
    qualified === 'yes' &&
    hasSignature;

  // Persists whatever's currently filled in, signature included, regardless of validity — used
  // on both Next and Back so a Back-then-forward round trip never wipes what was just entered
  // (previously Back skipped this entirely).
  const persist = async () => {
    updateRecord((r) => {
      r.operatorConsent.agreedNoDataMisuse = agreed;
      r.operatorConsent.operatorName = operatorName.trim();
      r.operatorConsent.operatorId = operatorId.trim();
      r.operatorConsent.qualificationAvailable = qualified === 'yes';
    });

    if (signatureRef.current) {
      if (signatureRef.current.isEmpty()) {
        updateRecord((r) => {
          r.operatorConsent.signaturePath = null;
        });
      } else if (signatureRef.current.hasUnsavedChanges()) {
        const path = record.operatorConsent.signaturePath ?? (await newMediaFilePath(record.id, 'operator_consent_signature'));
        await signatureRef.current.saveToFile(path);
        updateRecord((r) => {
          r.operatorConsent.signaturePath = path;
        });
      }
    }

    await saveDraft();
  };

  const onNext = async () => {
    await persist();

    const user = firebaseAuth.currentUser;
    if (user && !user.isAnonymous) {
      const profile: OperatorProfile = {
        operatorName: operatorName.trim(),
        operatorId: operatorId.trim(),
        phoneNumber: existingPhoneNumber.current,
        qualificationAvailable: qualified === 'yes',
        email: user.email,
        updatedAt: Date.now(),
      };
      saveOperatorProfile(user.uid, profile);
    }

    navigation.navigate('TestKit');
  };

  const onBack = async () => {
    await persist();
    navigation.goBack();
  };

  return (
    <KeyboardAvoidingScreen>
    <ScrollView
      contentContainerStyle={[styles.container, { paddingBottom: 20 + insets.bottom }]}
      scrollEnabled={scrollEnabled}
      keyboardShouldPersistTaps="handled"
    >
      <WizardHeader title="Operator Consent" step={3} />

      {profileNotice && <Text style={styles.profileNotice}>{profileNotice}</Text>}

      <FormSection title="Collector Declaration">
        <Text style={styles.bodyText}>{COLLECTOR_DECLARATION_TEXT}</Text>
        <Checkbox
          checked={agreed}
          onChange={(v) => {
            userEditedFields.current = true;
            setAgreed(v);
          }}
          label="I confirm the above statement *"
        />
      </FormSection>

      <FormSection title="Operator Details">
        <TextField
          label="Operator name *"
          value={operatorName}
          onChangeText={(v) => {
            userEditedFields.current = true;
            setOperatorName(v);
          }}
          startIcon="person"
        />
        <TextField
          label="Operator ID *"
          value={operatorId}
          onChangeText={(v) => {
            userEditedFields.current = true;
            setOperatorId(v);
          }}
          startIcon="badge"
        />
      </FormSection>

      <FormSection title="NZQA qualified? *">
        <RadioGroup
          options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
          value={qualified}
          onChange={onQualifiedChange}
          horizontal
        />
      </FormSection>

      <FormSection title="Signature *">
        <SignaturePad
          ref={signatureRef}
          initialFilePath={consent.signaturePath}
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
        <Button title="Next" trailingIcon="arrow-forward" onPress={onNext} disabled={!canProceed} style={styles.nextButton} />
      </View>
    </ScrollView>
    </KeyboardAvoidingScreen>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: colors.background },
  profileNotice: { fontSize: 12, color: colors.brandAccent, marginBottom: 12 },
  sectionLabel: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginTop: 20, marginBottom: 8 },
  bodyText: { fontSize: 12, color: colors.textSecondary, marginBottom: 8, lineHeight: 18 },
  clearSignatureButton: { alignSelf: 'flex-start', marginTop: 4 },
  bottomBar: { flexDirection: 'row', gap: 12, marginTop: 24 },
  backButton: { flex: 1 },
  nextButton: { flex: 1 },
});
