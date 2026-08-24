import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, ScrollView, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { resetTo } from '../navigation/resetTo';
import { firebaseAuth } from '../services/firebase';
import { getRole, ROLE_ADMIN, ensureAnonymousSession } from '../services/authSession';
import TextField from '../components/TextField';
import Button from '../components/Button';
import FormSection from '../components/FormSection';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'AdminLogin'>;

/**
 * Mirrors AdminLoginFragment.java. The one hidden-ish entry point into the Admin panel — reached
 * only via the small "Admin" link on Setup, not surfaced anywhere an operator would normally go.
 * There is exactly one admin account (see functions/index.js#bootstrapAdmin); this screen's only
 * job beyond normal sign-in is confirming the signed-in account actually carries the admin claim,
 * and rejecting (with a sign-out) anything that doesn't — an operator who somehow guessed their
 * way to this screen still can't get into the Admin panel with their own credentials.
 */
export default function AdminLoginScreen({ navigation }: Props) {
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

    setLoading(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(firebaseAuth, trimmedEmail, password);
      const role = await getRole();
      if (role !== ROLE_ADMIN) {
        await signOut(firebaseAuth);
        await ensureAnonymousSession();
        setLoading(false);
        setError('This account does not have admin access');
        return;
      }
      setLoading(false);
      resetTo(navigation, 'Admin');
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
        <Text style={styles.title}>Admin Login</Text>

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
  title: { textAlign: 'center', fontSize: 19, fontWeight: '700', color: colors.textPrimary, marginBottom: 28 },
  error: { color: colors.brandDanger, fontSize: 13, marginBottom: 12 },
  submit: { marginTop: 8 },
  forgot: { marginTop: 16, alignItems: 'center' },
  forgotText: { color: colors.brandAccent, fontSize: 14 },
});
