import 'react-native-gesture-handler';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, AppState, AppStateStatus } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as ScreenCapture from 'expo-screen-capture';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, NavigationState } from '@react-navigation/native';
import RootNavigator from './src/navigation/RootNavigator';
import { WorkflowProvider, loadResumableRecord } from './src/hooks/WorkflowContext';
import { TestRecord } from './src/models/TestRecord';
import { ToastProvider } from './src/components/Toast';
import { ensureAnonymousSession } from './src/services/authSession';
import { firebaseAuth } from './src/services/firebase';
import { startAutoSync } from './src/services/autoSync';
import { saveNavigationState, loadNavigationState, markBackgrounded } from './src/services/navigationPersistence';
import './src/services/firebase'; // initializes the shared Firebase app on import

// App-wide FLAG_SECURE equivalent -- blocks screenshots/screen recording everywhere, not just on
// the two screens (Summary, PdfViewer) that used to call this themselves. Set once here, for the
// app's entire lifetime, rather than per-screen: those two screens previously called
// allowScreenCaptureAsync() on unmount, which would have UNDONE this app-wide block the moment the
// operator navigated away from them -- removed in favor of this single, permanent call.
//
// PLATFORM DIFFERENCE (confirmed via expo-screen-capture's own docs, not assumed): this call is a
// genuine, OS-level block on Android (screenshots come back blank/refused), but iOS has no API for
// any app to prevent a screenshot at all -- preventScreenCaptureAsync() is a no-op there. The
// useScreenshotListener call below is the actual iOS mitigation available: it can't stop the
// screenshot, but it detects one was taken and warns the operator, which is the closest iOS
// equivalent to "protect this donor data from being captured" that the platform allows.
void ScreenCapture.preventScreenCaptureAsync();

// Keeps the native splash screen (see app.json's expo-splash-screen plugin config) on screen
// until hideAsync() below, instead of it disappearing the instant the first native frame draws —
// without this, there's a blank white flash between the OS launching the app and this component's
// own useEffect finishing its setup work.
void SplashScreen.preventAutoHideAsync();

/** Mirrors TrustCheckApplication.java's onCreate(): every app instance needs at least an
 *  anonymous Firebase Auth session so cloud sync/email Cloud Functions always have some auth
 *  context to work with, even before an operator signs in for real. */
export default function App() {
  // Overrides NavigationContainer's default start (Consent) with wherever the operator actually
  // was, but ONLY on a cold start that also finds an active in-progress record from a session that
  // was still "alive" (see navigationPersistence.ts#isSessionStillAlive) -- explicit product
  // requirement: briefly switching apps and getting reclaimed by the OS should resume; an actual
  // close-and-reopen much later should start fresh, same as a genuinely new session. Must be
  // resolved BEFORE NavigationContainer's first mount -- initialState has no effect if set after
  // the fact -- hence gating the whole tree on navReady below rather than just passing a
  // possibly-still-loading value. initialRecord is resolved in the SAME pass and handed straight
  // to WorkflowProvider (not loaded internally by it after mount) for the same reason -- see
  // loadResumableRecord's own doc for the real bug (blank-looking resumed screens) that split
  // otherwise caused.
  const [initialNavState, setInitialNavState] = useState<NavigationState | undefined>(undefined);
  const [initialRecord, setInitialRecord] = useState<TestRecord | null>(null);
  const [navReady, setNavReady] = useState(false);

  useEffect(() => {
    (async () => {
      await ensureAnonymousSession();
      // TEMPORARY diagnostic -- see SetupScreen/HistoryScreen's matching logs for the reported bug
      // this is chasing (a signed-in operator's session reading back as guest mode after a
      // close/reopen). This is the EARLIEST point auth state is knowable each launch.
      console.log('[App] after ensureAnonymousSession: currentUser =', firebaseAuth.currentUser?.uid ?? null, 'isAnonymous =', firebaseAuth.currentUser?.isAnonymous);
      startAutoSync();

      const resumed = await loadResumableRecord();
      if (resumed) {
        setInitialRecord(resumed);
        const savedState = await loadNavigationState();
        if (savedState) setInitialNavState(savedState);
      }
      setNavReady(true);

      await SplashScreen.hideAsync();
    })();
  }, []);

  // The only point in the app's lifecycle where "the app went to background" can actually be
  // observed -- must be recorded HERE, while still running, since a subsequent cold start (after
  // the OS reclaims the process) has no way to retroactively know when that happened. See
  // isSessionStillAlive's own doc for how this timestamp gets used.
  const appState = useRef(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (appState.current === 'active' && next !== 'active') {
        void markBackgrounded();
      }
      appState.current = next;
    });
    return () => subscription.remove();
  }, []);

  // No-op on Android (that platform's screenshots are already genuinely blocked above, so this
  // listener never fires there) -- on iOS, this is the actual protection: since the OS won't let
  // any app block the screenshot itself, at least make it visible that donor data was captured.
  ScreenCapture.useScreenshotListener(() => {
    Alert.alert('Screenshot detected', 'This screen may contain sensitive donor information.');
  });

  // Native splash screen (see SplashScreen.hideAsync above) is still covering the screen at this
  // point, so rendering nothing here has no visible effect -- it just avoids NavigationContainer
  // (and WorkflowProvider, and therefore every wizard screen) mounting before the check above has
  // resolved.
  if (!navReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ToastProvider>
          <WorkflowProvider initialRecord={initialRecord}>
            <NavigationContainer
              initialState={initialNavState}
              onStateChange={(state) => {
                // TEMPORARY diagnostic -- a reported bug ("pressing back after a rescan shows
                // every previous scan attempt instead of the previous wizard page") needs the
                // ACTUAL route stack at the moment it happens, not a guess. Remove once confirmed
                // and fixed.
                if (state) console.log('[NavStack] ' + state.routes.map((r) => r.name).join(' > '));
                void saveNavigationState(state);
              }}
            >
              <RootNavigator />
            </NavigationContainer>
            <StatusBar style="light" />
          </WorkflowProvider>
        </ToastProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
