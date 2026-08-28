import React, { useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../services/firebase';
import { isValidEmail } from '../models/TestSetup';
import TextField from '../components/TextField';
import Button from '../components/Button';
import FormSection from '../components/FormSection';
import KeyboardAvoidingScreen from '../components/KeyboardAvoidingScreen';
import { colors } from '../theme';

/**
 * Mirrors ForgotPasswordFragment.java. Shared by both the operator and admin login screens —
 * "forgot password" always means "send a reset link," never "tell me my existing password back"
 * (Firebase Auth has no way to recover a plaintext password even server-side, and that's the
 * right call security-wise regardless).
 *
 * Goes through the sendPasswordReset Cloud Function (functions/index.js, untouched — same
 * backend as the native app) rather than Firebase Auth's own built-in email delivery, which was
 * never confirmed to actually work for this project.
 *
 * Explicitly tells the operator/admin whether the email is registered — a deliberate choice for
 * this internal company tool, not a public-facing app where that would enable probing for valid
 * accounts.
 */
export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const trimmed = email.trim();
    if (!trimmed || !isValidEmail(trimmed)) {
      setMessage({ text: 'Enter a valid email address', isError: true });
      return;
    }

    setLoading(true);
    setMessage(null);
    try {
      const result = await httpsCallable(functions, 'sendPasswordReset')({ email: trimmed });
      const body = result.data as { exists?: boolean } | undefined;
      setLoading(false);
      if (body?.exists) {
        setMessage({ text: `Check your email — a password reset link has been sent to ${trimmed}.`, isError: false });
      } else {
        setMessage({ text: 'No account was found with this email address.', isError: true });
      }
    } catch (e) {
      setLoading(false);
      setMessage({ text: `Could not send reset email: ${(e as Error).message}`, isError: true });
    }
  };

  return (
    <KeyboardAvoidingScreen
      contentContainerStyle={[styles.container, { paddingBottom: 20 + insets.bottom }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Reset your password</Text>
      <Text style={styles.hint}>
        Enter your account email and we&apos;ll send you a link to set a new password.
      </Text>

      <FormSection>
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          startIcon="email"
        />

        {message ? (
          <Text style={[styles.message, message.isError ? styles.error : styles.success]}>
            {message.text}
          </Text>
        ) : null}

        <Button title="Send Reset Link" onPress={submit} loading={loading} style={styles.submit} />
      </FormSection>
    </KeyboardAvoidingScreen>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: colors.background, padding: 20 },
  title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginBottom: 8 },
  hint: { fontSize: 13, color: colors.textSecondary, marginBottom: 20 },
  message: { fontSize: 13, marginBottom: 12 },
  error: { color: colors.brandDanger },
  success: { color: colors.brandSuccess },
  submit: { marginTop: 8 },
});
