import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, ScrollView, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { resetTo } from '../navigation/resetTo';
import { firebaseAuth } from '../services/firebase';
import { getRole, ROLE_ADMIN, OPERATOR_EMAIL_DOMAIN, ensureAnonymousSession } from '../services/authSession';
import TextField from '../components/TextField';
import Button from '../components/Button';
import FormSection from '../components/FormSection';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

/**
 * Mirrors LoginFragment.java. Operators sign in with an email/password account created for them
 * ahead of time by an admin (see the Admin panel) — there is deliberately no self-signup here.
 * If sign-in fails there is no "create account" fallback to guide toward; the message just tells
 * them to contact their administrator.
 *
 * Restricted to the company email domain — this is only a client-side courtesy check for a
 * faster/clearer error; the real enforcement is server-side, in functions/index.js#createOperator,
 * which is the only way an operator account can ever be created in the first place.
 */
export default function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const attemptLogin = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError('Enter your email and password');
      return;
    }
    if (!trimmedEmail.toLowerCase().endsWith(OPERATOR_EMAIL_DOMAIN)) {
      setError(`Operator accounts must use a ${OPERATOR_EMAIL_DOMAIN} email address`);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(firebaseAuth, trimmedEmail, password);
      const role = await getRole();
      if (role === ROLE_ADMIN) {
        // Wrong door — this account belongs on the (separate, deliberately unadvertised) Admin
        // login instead. Sign back out rather than let an admin end up inside the operator-only
        // flow this screen leads into.
        await signOut(firebaseAuth);
        await ensureAnonymousSession();
        setLoading(false);
        setError('This is an admin account — use the Admin login instead');
        return;
      }
      setLoading(false);
      resetTo(navigation, 'History');
    } catch (e) {
      setLoading(false);
      const code = (e as { code?: string }).code ?? '';
      if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setError('Incorrect email or password');
      } else {
        setError(`Sign-in failed: ${(e as Error).message}`);
      }
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Image source={require('../../assets/logo.png')} style={styles.logo} resizeMode="contain" />
        <Text style={styles.title}>Operator Login</Text>
        <Text style={styles.hint}>
          Sign in with the operator account your administrator set up for you. Accounts aren&apos;t created in
          the app — contact your administrator if you don&apos;t have one.
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
          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            startIcon="lock"
            endIcon={showPassword ? 'visibility-off' : 'visibility'}
            onEndIconPress={() => setShowPassword((v) => !v)}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button title="Login" onPress={attemptLogin} loading={loading} style={styles.submit} />
        </FormSection>

        <Pressable onPress={() => navigation.navigate('ForgotPassword')} style={styles.forgot}>
          <Text style={styles.forgotText}>Forgot password?</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, backgroundColor: colors.background, padding: 20, justifyContent: 'center' },
  logo: { width: 64, height: 64, alignSelf: 'center', marginBottom: 12 },
  title: { textAlign: 'center', fontSize: 19, fontWeight: '700', color: colors.textPrimary, marginBottom: 6 },
  hint: { textAlign: 'center', fontSize: 13, color: colors.textSecondary, lineHeight: 18, marginBottom: 24 },
  error: { color: colors.brandDanger, fontSize: 13, marginBottom: 12 },
  submit: { marginTop: 8 },
  forgot: { marginTop: 16, alignItems: 'center' },
  forgotText: { color: colors.brandAccent, fontSize: 14 },
});
