import React, { useEffect, useState } from 'react';
import { View, Text, Image, ScrollView, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Checkbox from '../components/Checkbox';
import Button from '../components/Button';
import FormSection from '../components/FormSection';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { resetTo } from '../navigation/resetTo';
import { colors } from '../theme';

const CONSENT_GIVEN_KEY = 'consent_given';

const PRIVACY_PREFIX =
  "* I consent to the processing of my personal data in the context of the use of analysis " +
  'functions in our app, as well as the storage of information and access to my device, in order ' +
  'to evaluate the usage behavior of our app and to be able to continuously improve our offer. ' +
  'You have the right to withdraw your consent at any time. For more information, please see our ';

type Props = NativeStackScreenProps<RootStackParamList, 'Consent'>;

/** Mirrors ConsentFragment.java — a first-run app license/privacy consent gate, persisted
 *  locally so it's only ever shown once per device. */
export default function ConsentScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(true);
  const [license, setLicense] = useState(false);
  const [privacy, setPrivacy] = useState(false);

  useEffect(() => {
    (async () => {
      const given = await AsyncStorage.getItem(CONSENT_GIVEN_KEY);
      if (given === 'true') {
        resetTo(navigation, 'Setup');
        return;
      }
      setChecking(false);
    })();
  }, [navigation]);

  if (checking) return null;

  const canContinue = license && privacy;

  const onContinue = async () => {
    await AsyncStorage.setItem(CONSENT_GIVEN_KEY, 'true');
    navigation.navigate('Setup');
  };

  const showPrivacyStatement = () => {
    Alert.alert('Privacy Statement', PRIVACY_PREFIX);
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Image source={require('../../assets/logo.png')} style={styles.logo} resizeMode="contain" />
        <Text style={styles.appName}>TrustCheck</Text>
        <Text style={styles.title}>Consent</Text>

        <FormSection>
          <Checkbox
            checked={license}
            onChange={setLicense}
            label="* I agree with the App License Terms"
          />

          <Checkbox checked={privacy} onChange={setPrivacy} label={PRIVACY_PREFIX}>
            <Text style={styles.link} onPress={showPrivacyStatement}>
              Privacy Statement
            </Text>
          </Checkbox>
        </FormSection>
      </ScrollView>
      <View style={[styles.bottomBar, { paddingBottom: 16 + insets.bottom }]}>
        <Button title="Continue" onPress={onContinue} disabled={!canContinue} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 20 },
  logo: { width: 72, height: 72, alignSelf: 'center', marginBottom: 12 },
  appName: { alignSelf: 'center', fontSize: 18, fontWeight: '700', color: colors.brandPrimary },
  title: {
    alignSelf: 'center',
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 20,
    marginBottom: 16,
  },
  link: { color: colors.brandAccent, fontWeight: '600' },
  bottomBar: { padding: 16, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider },
});
