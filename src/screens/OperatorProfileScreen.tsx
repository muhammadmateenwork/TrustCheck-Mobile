import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { firebaseAuth } from '../services/firebase';
import { fetchOperatorProfile, saveOperatorProfile } from '../services/operatorProfileRepository';
import TextField from '../components/TextField';
import RadioGroup, { RadioOption } from '../components/RadioGroup';
import Button from '../components/Button';
import ChangePasswordModal from '../components/ChangePasswordModal';
import { useToast } from '../components/Toast';
import FormSection from '../components/FormSection';
import KeyboardAvoidingScreen from '../components/KeyboardAvoidingScreen';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'OperatorProfile'>;

const QUALIFICATION_OPTIONS: RadioOption<'yes' | 'no'>[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

/**
 * An operator can view and update their own profile here — name, ID, qualification, phone — but
 * there is deliberately no way to delete the account from this screen, matching
 * OperatorProfileFragment.java: accounts are provisioned by whoever administers the app, so their
 * lifecycle is managed the same way, outside the app.
 */
export default function OperatorProfileScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const user = firebaseAuth.currentUser;
  const [name, setName] = useState('');
  const [operatorId, setOperatorId] = useState('');
  const [phone, setPhone] = useState('');
  const [qualification, setQualification] = useState<'yes' | 'no' | null>(null);
  const [saving, setSaving] = useState(false);
  const [changePasswordVisible, setChangePasswordVisible] = useState(false);

  // fetchOperatorProfile may call its onLoaded callback twice for the same call — once from
  // cache, once from a background server refresh (see that function's own doc) — so an edit made
  // in between must not be silently clobbered when the slower server copy lands.
  const userEditedFields = useRef(false);

  useEffect(() => {
    if (!user || user.isAnonymous) {
      showToast('You need to be logged in to view your profile', 'error');
      navigation.goBack();
      return;
    }
    void fetchOperatorProfile(
      user.uid,
      (profile) => {
        if (!profile || userEditedFields.current) return;
        setName(profile.operatorName ?? '');
        setOperatorId(profile.operatorId ?? '');
        setPhone(profile.phoneNumber ?? '');
        if (profile.qualificationAvailable != null) {
          setQualification(profile.qualificationAvailable ? 'yes' : 'no');
        }
      },
      (e) => {
        // A genuine fetch failure (network/permission) — not "no profile yet", which flows
        // through onLoaded(null) instead. Worth telling the operator, since otherwise the form
        // just silently sits blank with no indication anything went wrong.
        showToast(`Could not load your saved profile: ${(e as Error).message}`, 'error');
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markEdited = <T,>(setter: (v: T) => void) => (v: T) => {
    userEditedFields.current = true;
    setter(v);
  };

  const isValid = name.trim() !== '' && operatorId.trim() !== '' && phone.trim() !== '' && qualification != null;

  const onSave = async () => {
    if (!user || !isValid) return;
    setSaving(true);
    try {
      await saveOperatorProfile(user.uid, {
        operatorName: name.trim(),
        operatorId: operatorId.trim(),
        phoneNumber: phone.trim(),
        qualificationAvailable: qualification === 'yes',
        email: user.email,
        updatedAt: Date.now(),
      });
      setSaving(false);
      showToast('Profile saved', 'success');
      navigation.goBack();
    } catch (e) {
      setSaving(false);
      showToast(`Could not save profile: ${(e as Error).message}`, 'error');
    }
  };

  return (
    <KeyboardAvoidingScreen>
    <ScrollView
      contentContainerStyle={[styles.container, { paddingBottom: 20 + insets.bottom }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.email}>{user?.email}</Text>

      <FormSection>
        <TextField label="Operator name" value={name} onChangeText={markEdited(setName)} startIcon="person" />
        <TextField label="Operator ID" value={operatorId} onChangeText={markEdited(setOperatorId)} startIcon="badge" />
        <TextField label="Phone number" value={phone} onChangeText={markEdited(setPhone)} keyboardType="phone-pad" startIcon="phone" />

        <Text style={styles.qualificationLabel}>Qualification available?</Text>
        <RadioGroup options={QUALIFICATION_OPTIONS} value={qualification} onChange={markEdited(setQualification)} horizontal />
      </FormSection>

      <Button title="Save" onPress={() => void onSave()} loading={saving} disabled={!isValid} style={styles.saveButton} />
      <Button
        title="Change Password"
        variant="outlined"
        onPress={() => setChangePasswordVisible(true)}
        style={styles.changePasswordButton}
      />

      <Text style={styles.note}>
        Accounts are set up by your administrator and can&apos;t be deleted from within the app.
      </Text>

      <ChangePasswordModal visible={changePasswordVisible} onClose={() => setChangePasswordVisible(false)} />
    </ScrollView>
    </KeyboardAvoidingScreen>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: colors.background },
  email: { fontSize: 13, color: colors.textSecondary, marginBottom: 20 },
  qualificationLabel: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginTop: 20, marginBottom: 4 },
  saveButton: { marginTop: 28 },
  changePasswordButton: { marginTop: 12 },
  note: { fontSize: 12, color: colors.textSecondary, textAlign: 'center', marginTop: 16 },
});
