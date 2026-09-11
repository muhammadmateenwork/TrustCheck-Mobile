import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, Alert, ActivityIndicator } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { signOut } from 'firebase/auth';
import { MaterialIcons } from '@expo/vector-icons';
import { RootStackParamList } from '../navigation/types';
import { resetTo } from '../navigation/resetTo';
import { firebaseAuth } from '../services/firebase';
import { ensureAnonymousSession } from '../services/authSession';
import { retryPendingSyncs } from '../services/cloudSync';
import Button from '../components/Button';
import { useWorkflow } from '../hooks/WorkflowContext';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'History'>;

/**
 * Mirrors HistoryFragment.java's operator-role behavior (isOperatorRole there), but deliberately
 * extended to anonymous (skipped-login) sessions too, per explicit product direction: this screen
 * never shows a browsable/searchable list of past tests to anyone, named operator or anonymous —
 * a shared device could be picked up by anyone after tapping Skip, and that random person having
 * search/filter access to previously collected donors' names, IDs, and photos is exactly the same
 * privacy problem a logged-in operator not seeing their own past tests here already guards
 * against. Every non-admin session gets the same restricted view: just "+ New Test".
 */
export default function HistoryScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { startNew } = useWorkflow();
  const [menuVisible, setMenuVisible] = useState(false);
  const [realOperatorLoggedIn, setRealOperatorLoggedIn] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const refreshMenuVisibility = useCallback(() => {
    const user = firebaseAuth.currentUser;
    // TEMPORARY diagnostic -- see SetupScreen's own matching log for why.
    console.log('[History] currentUser =', user ? user.uid : null, 'isAnonymous =', user?.isAnonymous, 'email =', user?.email);
    setRealOperatorLoggedIn(!!user && !user.isAnonymous);
  }, []);

  useEffect(() => {
    refreshMenuVisibility();
    // Self-gating, cheap when nothing's pending — safe to call on every visit to Home, which
    // is what makes it a real fix for a test that failed to sync once and would otherwise
    // never retry. See cloudSync.retryPendingSyncs.
    void retryPendingSyncs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      refreshMenuVisibility();
      void retryPendingSyncs();
    });
    return unsubscribe;
  }, [navigation, refreshMenuVisibility]);

  const onNewTest = () => {
    startNew();
    navigation.navigate('DonorData');
  };

  const operatorEmail = firebaseAuth.currentUser?.email ?? null;

  const confirmSignOut = () => {
    setMenuVisible(false);
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          // Both calls are real network round trips (Firebase Auth sign-out + a fresh anonymous
          // sign-in) — without this, the app just looked frozen for however long that took.
          setSigningOut(true);
          try {
            await signOut(firebaseAuth);
            await ensureAnonymousSession();
            resetTo(navigation, 'Setup', { justSignedOut: true });
          } finally {
            setSigningOut(false);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.title}>TrustCheck</Text>
        <Pressable onPress={() => setMenuVisible(true)} style={styles.menuButton}>
          <MaterialIcons name="more-vert" size={24} color={colors.white} />
        </Pressable>
      </View>

      <View style={styles.homeMessage}>
        <View style={styles.badge}>
          <MaterialIcons name="fact-check" size={40} color={colors.white} />
        </View>
        <Text style={styles.homeTitle}>TrustCheck</Text>
        <Text style={styles.homeSubtitle}>
          {realOperatorLoggedIn && operatorEmail ? `Signed in as ${operatorEmail}` : 'Guest session'}
        </Text>
        <Text style={styles.homeText}>Tap New Test below to start a donor drug &amp; alcohol test.</Text>
      </View>

      <Button title="New Test" icon="add" onPress={onNewTest} style={[styles.fab, { bottom: 24 + insets.bottom }]} />

      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuVisible(false)}>
          <View style={styles.menuCard}>
            {!realOperatorLoggedIn && (
              <Pressable
                style={styles.menuItem}
                onPress={() => {
                  setMenuVisible(false);
                  navigation.navigate('Login');
                }}
              >
                <Text style={styles.menuItemText}>Login</Text>
              </Pressable>
            )}
            {realOperatorLoggedIn && (
              <Pressable
                style={styles.menuItem}
                onPress={() => {
                  setMenuVisible(false);
                  navigation.navigate('OperatorProfile');
                }}
              >
                <Text style={styles.menuItemText}>My Profile</Text>
              </Pressable>
            )}
            {realOperatorLoggedIn && (
              <Pressable
                style={styles.menuItem}
                onPress={() => {
                  setMenuVisible(false);
                  navigation.navigate('MyTestCounts');
                }}
              >
                <Text style={styles.menuItemText}>Test Analytics</Text>
              </Pressable>
            )}
            {realOperatorLoggedIn && (
              <Pressable style={styles.menuItem} onPress={confirmSignOut}>
                <Text style={styles.menuItemText}>Sign Out</Text>
              </Pressable>
            )}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={signingOut} transparent animationType="fade">
        <View style={styles.signingOutOverlay}>
          <View style={styles.signingOutCard}>
            <ActivityIndicator color={colors.brandPrimary} />
            <Text style={styles.signingOutText}>Signing out…</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 14,
  },
  title: { fontSize: 20, fontWeight: '700', color: colors.white },
  menuButton: { padding: 8 },
  homeMessage: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  badge: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    elevation: 3,
    shadowColor: colors.black,
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  homeTitle: { fontSize: 24, fontWeight: '700', color: colors.textPrimary, marginBottom: 6 },
  homeSubtitle: { fontSize: 13, color: colors.brandAccent, fontWeight: '600', textAlign: 'center', marginBottom: 16 },
  homeText: { fontSize: 15, color: colors.textSecondary, textAlign: 'center' },
  fab: { position: 'absolute', right: 16, bottom: 24, left: 16 },
  menuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.2)' },
  menuCard: {
    position: 'absolute',
    top: 90,
    right: 16,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingVertical: 6,
    minWidth: 160,
    elevation: 4,
    shadowColor: colors.black,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  menuItem: { paddingVertical: 12, paddingHorizontal: 16 },
  menuItemText: { fontSize: 14, color: colors.textPrimary },
  signingOutOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'center', justifyContent: 'center' },
  signingOutCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 24,
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  signingOutText: { marginTop: 12, fontSize: 14, color: colors.textPrimary, fontWeight: '600' },
});
