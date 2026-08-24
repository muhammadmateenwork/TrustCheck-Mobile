import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MaterialIcons } from '@expo/vector-icons';
import { RootStackParamList } from '../navigation/types';
import { useWorkflow } from '../hooks/WorkflowContext';
import Button from '../components/Button';
import FormSection from '../components/FormSection';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'DrugTestPicture'>;

/** Mirrors DrugTestPictureFragment.java. */
export default function DrugTestPictureScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { record, updateRecord, saveDraft } = useWorkflow();
  const [photoPath, setPhotoPath] = useState<string | null>(record.drugTestPhotoPath);
  const [detectionFailed, setDetectionFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const lastHandledScan = useRef<number | undefined>(undefined);

  useEffect(() => {
    const scanAt = route.params?.scanAt;
    if (!scanAt || lastHandledScan.current === scanAt) return;
    lastHandledScan.current = scanAt;
    onScanResult();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.scanAt]);

  const onScanResult = async () => {
    const photo = route.params?.photoPath;
    if (!photo) return;

    updateRecord((r) => {
      r.drugTestPhotoPath = photo;
    });
    setPhotoPath(photo);

    const readValid = !!route.params?.readValid;
    const detectionAttempted = route.params?.detectionAttempted !== false;

    if (!readValid && record.drugResult.autoDetected) {
      // The photo just changed (retake failed to auto-read, or "Skip auto-detect" was used), so
      // whatever an EARLIER capture auto-detected no longer describes this photo.
      updateRecord((r) => {
        r.drugResult.overallResult = null;
        r.drugResult.substanceResults = {};
        r.drugResult.autoDetected = false;
      });
    }

    await saveDraft();

    if (readValid) {
      setDetectionFailed(false);
      setNotice("Result auto-detected — you'll be able to review and confirm it next");
      navigation.navigate('DrugResult');
    } else if (detectionAttempted) {
      // Detection was actually tried and came back short — stay here and say so plainly.
      setDetectionFailed(true);
    } else {
      // "Skip auto-detect" — the operator explicitly opted out, proceed straight to manual entry.
      setDetectionFailed(false);
      navigation.navigate('DrugResult');
    }
  };

  // The moment right before backgrounding for the cassette camera flow is the highest-risk one
  // for losing whatever hasn't been saved yet — that screen holds a live camera preview and runs
  // repeated capture+analysis passes, peak memory pressure for the OS to reclaim this process at.
  const onTakePhoto = async () => {
    await saveDraft();
    navigation.navigate('DrugCassetteScan');
  };

  return (
    <ScrollView contentContainerStyle={[styles.container, { paddingBottom: 20 + insets.bottom }]}>
      <Text style={styles.title}>Drug Test</Text>
      <Text style={styles.instruction}>Take a photo of the drug test kit result.</Text>

      {notice && <Text style={styles.notice}>{notice}</Text>}

      <FormSection>
        <View style={styles.photoBox}>
          {photoPath ? (
            <Image source={{ uri: photoPath }} style={styles.photo} resizeMode="contain" />
          ) : (
            <>
              <MaterialIcons name="camera-alt" size={40} color={colors.textSecondary} />
              <Text style={styles.emptyText}>No photo taken yet</Text>
            </>
          )}
        </View>

        {detectionFailed && (
          <Text style={styles.failedText}>
            Image captured was not clear — unable to detect results. Press Next to add the result
            manually, or retake the picture.
          </Text>
        )}

        <Button
          title={photoPath ? 'Rescan Kit' : 'Scan Kit'}
          icon="camera-alt"
          variant="outlined"
          onPress={() => void onTakePhoto()}
          style={styles.takePhotoButton}
        />
      </FormSection>

      <View style={styles.bottomBar}>
        <Button title="Back" icon="arrow-back" variant="outlined" onPress={() => navigation.goBack()} style={styles.backButton} />
        <Button
          title="Next"
          trailingIcon="arrow-forward"
          onPress={() => navigation.navigate('DrugResult')}
          disabled={!photoPath}
          style={styles.nextButton}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: colors.background },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginBottom: 8 },
  instruction: { fontSize: 13, color: colors.textSecondary, marginBottom: 16 },
  notice: { fontSize: 12, color: colors.brandAccent, marginBottom: 12 },
  photoBox: {
    height: 260,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photo: { width: '100%', height: '100%' },
  emptyText: { color: colors.textSecondary, fontSize: 13, marginTop: 8 },
  failedText: { fontSize: 14, color: colors.brandDanger, marginTop: 12 },
  takePhotoButton: { marginTop: 16 },
  bottomBar: { flexDirection: 'row', gap: 12, marginTop: 24 },
  backButton: { flex: 1 },
  nextButton: { flex: 1 },
});
