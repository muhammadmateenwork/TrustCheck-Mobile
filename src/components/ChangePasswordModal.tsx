import React, { useState } from 'react';
import { Modal, View, Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import TextField from './TextField';
import Button from './Button';
import { changePassword } from '../services/changePassword';
import { useToast } from './Toast';
import { colors } from '../theme';

/** Mirrors ChangePasswordDialog.java — "update your own password while already signed in." */
export default function ChangePasswordModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { showToast } = useToast();
  const [current, setCurrent] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const reset = () => {
    setCurrent('');
    setNewPassword('');
    setConfirm('');
    setShowCurrent(false);
    setShowNew(false);
    setShowConfirm(false);
  };

  const submit = async () => {
    if (newPassword.length < 6) {
      showToast('Password must be at least 6 characters', 'error');
      return;
    }
    if (newPassword !== confirm) {
      showToast('Passwords do not match', 'error');
      return;
    }
    setLoading(true);
    try {
      await changePassword(current, newPassword);
      setLoading(false);
      reset();
      onClose();
      showToast('Password changed', 'success');
    } catch (e) {
      setLoading(false);
      showToast((e as Error).message || 'Could not change password', 'error');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.title}>Change Password</Text>
            <TextField
              label="Current password"
              value={current}
              onChangeText={setCurrent}
              secureTextEntry={!showCurrent}
              startIcon="lock"
              endIcon={showCurrent ? 'visibility-off' : 'visibility'}
              onEndIconPress={() => setShowCurrent((v) => !v)}
            />
            <TextField
              label="New password"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry={!showNew}
              startIcon="lock"
              endIcon={showNew ? 'visibility-off' : 'visibility'}
              onEndIconPress={() => setShowNew((v) => !v)}
            />
            <TextField
              label="Confirm new password"
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry={!showConfirm}
              startIcon="lock"
              endIcon={showConfirm ? 'visibility-off' : 'visibility'}
              onEndIconPress={() => setShowConfirm((v) => !v)}
            />
            <Button title="Change Password" onPress={submit} loading={loading} style={styles.submitButton} />
            <Button
              title="Cancel"
              variant="text"
              onPress={() => {
                reset();
                onClose();
              }}
              style={styles.cancelButton}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: 20 },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginBottom: 12 },
  submitButton: { marginTop: 8 },
  cancelButton: { marginTop: 4 },
});
