import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './types';
import { colors } from '../theme';

import ConsentScreen from '../screens/ConsentScreen';
import SetupScreen from '../screens/SetupScreen';
import LoginScreen from '../screens/LoginScreen';
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen';
import AdminLoginScreen from '../screens/AdminLoginScreen';
import HistoryScreen from '../screens/HistoryScreen';
import DonorDataScreen from '../screens/DonorDataScreen';
import TestSetupScreen from '../screens/TestSetupScreen';
import OperatorConsentScreen from '../screens/OperatorConsentScreen';
import TestKitScreen from '../screens/TestKitScreen';
import QrScanScreen from '../screens/QrScanScreen';
import DrugTestPictureScreen from '../screens/DrugTestPictureScreen';
import DrugCassetteScanScreen from '../screens/DrugCassetteScanScreen';
import DrugResultScreen from '../screens/DrugResultScreen';
import AlcoholTestScreen from '../screens/AlcoholTestScreen';
import FinalSignOffScreen from '../screens/FinalSignOffScreen';
import PdfViewerScreen from '../screens/PdfViewerScreen';
import SummaryScreen from '../screens/SummaryScreen';
import AdminScreen from '../screens/AdminScreen';
import OperatorProfileScreen from '../screens/OperatorProfileScreen';
import MyTestCountsScreen from '../screens/MyTestCountsScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Mirrors app/src/main/res/navigation/nav_graph.xml — same destinations, same start
 *  destination (Consent), same flow. */
export default function RootNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Consent"
      screenOptions={{
        headerStyle: { backgroundColor: colors.brandPrimary },
        headerTintColor: colors.white,
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="Consent" component={ConsentScreen} options={{ title: 'Consent', headerShown: false }} />
      <Stack.Screen name="Setup" component={SetupScreen} options={{ title: 'Setup', headerShown: false }} />
      <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'Login' }} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ title: 'Reset Password' }} />
      <Stack.Screen name="AdminLogin" component={AdminLoginScreen} options={{ title: 'Admin Login' }} />
      <Stack.Screen name="Admin" component={AdminScreen} options={{ title: 'Admin', headerShown: false }} />
      <Stack.Screen name="DonorData" component={DonorDataScreen} options={{ title: 'Donor Data' }} />
      <Stack.Screen name="TestSetup" component={TestSetupScreen} options={{ title: 'Test Setup' }} />
      <Stack.Screen name="OperatorConsent" component={OperatorConsentScreen} options={{ title: 'Operator Consent' }} />
      <Stack.Screen name="TestKit" component={TestKitScreen} options={{ title: 'Test Kit Information' }} />
      <Stack.Screen name="DrugTestPicture" component={DrugTestPictureScreen} options={{ title: 'Drug Test' }} />
      <Stack.Screen
        name="DrugCassetteScan"
        component={DrugCassetteScanScreen}
        // Deliberately NOT presentation: 'fullScreenModal' (see this file's own git history) --
        // confirmed via real on-device nav-stack logging that returning from a fullScreenModal
        // screen via navigate({..., merge: true}) does not collapse back onto the ALREADY-PRESENT
        // instance of the presenting screen the way it does for a plain push screen; it pushes a
        // SECOND instance on top of the modal instead. Every retake/rescan therefore grew the
        // stack by one DrugTestPicture+DrugCassetteScan pair instead of staying flat -- confirmed
        // repeatedly today, the stack was 4 pairs deep after 4 retries in one session. A plain
        // push screen (still headerShown: false, so visually still a full-bleed camera view) dedupes
        // correctly by default and was the actual fix, not a workaround.
        options={{ title: 'Scan Cassette', headerShown: false }}
      />
      <Stack.Screen name="DrugResult" component={DrugResultScreen} options={{ title: 'Drug Test Result' }} />
      <Stack.Screen name="AlcoholTest" component={AlcoholTestScreen} options={{ title: 'Alcohol Test' }} />
      <Stack.Screen name="FinalSignOff" component={FinalSignOffScreen} options={{ title: 'Final Sign-off' }} />
      <Stack.Screen name="Summary" component={SummaryScreen} options={{ title: 'Report', headerShown: false }} />
      <Stack.Screen name="History" component={HistoryScreen} options={{ title: 'TrustCheck', headerShown: false }} />
      <Stack.Screen name="OperatorProfile" component={OperatorProfileScreen} options={{ title: 'My Profile' }} />
      <Stack.Screen name="MyTestCounts" component={MyTestCountsScreen} options={{ title: 'Test Summary' }} />
      <Stack.Screen name="PdfViewer" component={PdfViewerScreen} options={{ title: 'Report', presentation: 'fullScreenModal' }} />
      <Stack.Screen
        name="QrScan"
        component={QrScanScreen}
        // See DrugCassetteScan's own comment on why this isn't presentation: 'fullScreenModal' --
        // same navigate({...merge:true}) return pattern (see QrScanScreen), same stack-duplication
        // bug on modal-to-push returns.
        options={{ title: 'Scan QR', headerShown: false }}
      />
    </Stack.Navigator>
  );
}
