import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import RootNavigator from './src/navigation/RootNavigator';
import { WorkflowProvider } from './src/hooks/WorkflowContext';
import { ToastProvider } from './src/components/Toast';
import { ensureAnonymousSession } from './src/services/authSession';
import { startAutoSync } from './src/services/autoSync';
import './src/services/firebase'; // initializes the shared Firebase app on import

/** Mirrors TrustCheckApplication.java's onCreate(): every app instance needs at least an
 *  anonymous Firebase Auth session so cloud sync/email Cloud Functions always have some auth
 *  context to work with, even before an operator signs in for real. */
export default function App() {
  useEffect(() => {
    void ensureAnonymousSession();
    startAutoSync();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ToastProvider>
          <WorkflowProvider>
            <NavigationContainer>
              <RootNavigator />
            </NavigationContainer>
            <StatusBar style="light" />
          </WorkflowProvider>
        </ToastProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
