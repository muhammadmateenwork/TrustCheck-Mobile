import React, { useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet, Pressable } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { resetTo } from '../navigation/resetTo';
import { firebaseAuth } from '../services/firebase';
import { getRole, ROLE_ADMIN } from '../services/authSession';
import Button from '../components/Button';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Setup'>;

/**
 * Mirrors SetupFragment.java. Firebase Auth sessions persist across app restarts — an operator
 * (or admin) who logged in last time is still logged in now, so asking them to choose Login/Skip
 * again here would be both redundant and misleading: tapping Skip wouldn't actually log them
 * out, it would just navigate past this screen while the same real session kept going
 * underneath. Only show the choice at all when there's genuinely nothing to skip past — i.e. no
 * real login already active.
 */
export default function SetupScreen({ navigation, route }: Props) {
  const justSignedOut = route.params?.justSignedOut ?? false;
  const [checkingSession, setCheckingSession] = useState(!justSignedOut);

  useEffect(() => {
    // Skip the auto-redirect entirely right after an explicit Sign Out -- see this param's own
    // doc in navigation/types.ts for why re-deriving session state here specifically races the
    // signOut()+signInAnonymously() sequence that just ran.
    if (justSignedOut) return;
    const user = firebaseAuth.currentUser;
    // TEMPORARY diagnostic -- a reported bug ("test was performed while signed in as an operator,
    // but after a close/reopen it reads as guest mode and Home shows Login") needs the ACTUAL auth
    // state at the moment this screen decides where to send the operator, not a guess. Remove once
    // confirmed and fixed.
    console.log('[Setup] currentUser =', user ? user.uid : null, 'isAnonymous =', user?.isAnonymous, 'email =', user?.email);
    if (user && !user.isAnonymous) {
      (async () => {
        const role = await getRole();
        resetTo(navigation, role === ROLE_ADMIN ? 'Admin' : 'History');
      })();
      return;
    }
    setCheckingSession(false);
  }, [navigation, justSignedOut]);

  if (checkingSession) return null;

  return (
    <View style={styles.container}>
      <Image source={require('../../assets/logo.png')} style={styles.logo} resizeMode="contain" />
      <Text style={styles.title}>TrustCheck</Text>
      <View style={styles.buttons}>
        <Button title="Login" onPress={() => navigation.navigate('Login')} />
        <Button
          title="Skip"
          variant="outlined"
          style={styles.spaced}
          onPress={() => resetTo(navigation, 'History')}
        />
      </View>
      {/* Deliberately small/muted rather than a peer of Login/Skip — this is for the one admin
          account, not something every operator opening the app needs to notice. */}
      <Pressable onPress={() => navigation.navigate('AdminLogin')} style={styles.adminLink}>
        <Text style={styles.adminLinkText}>Admin</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 24 },
  logo: { width: 88, height: 88, marginBottom: 16 },
  title: { fontSize: 28, fontWeight: '700', color: colors.brandPrimary, marginBottom: 40 },
  buttons: { width: '100%' },
  spaced: { marginTop: 12 },
  adminLink: { marginTop: 32, padding: 8 },
  adminLinkText: { color: colors.textSecondary, fontSize: 13 },
});
