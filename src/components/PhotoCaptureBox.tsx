import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { MaterialIcons } from '@expo/vector-icons';
import { newPhotoFilePath } from '../services/fileStorage';
import { useToast } from './Toast';
import { colors } from '../theme';

interface Props {
  photoPath: string | null;
  onCaptured: (localUri: string) => void;
  /** Record this photo belongs to, and a short prefix for the saved file name — used to copy the
   *  picker's result out of expo-image-picker's cache into the app's own private media dir (see
   *  fileStorage.ts). Skipping that copy and using the cache URI directly would leave the photo
   *  path pointing at a file the OS is free to reclaim under storage pressure — the same failure
   *  mode PhotoCaptureController.java's newPhotoFile(recordId, prefix) exists to avoid natively. */
  recordId: string;
  filePrefix: string;
  emptyLabel?: string;
  takeLabel?: string;
  retakeLabel?: string;
}

/**
 * Shared photo-capture box for the simpler photo screens (donor ID, alcohol test) — mirrors
 * PhotoCaptureController.java + partial_photo_capture_box.xml: launches the system camera app
 * directly (not a custom in-app preview, unlike the drug cassette scan screen) and shows a
 * preview once captured.
 */
export default function PhotoCaptureBox({
  photoPath,
  onCaptured,
  recordId,
  filePrefix,
  emptyLabel = 'No photo taken yet',
  takeLabel = 'Take Photo',
  retakeLabel = 'Retake Photo',
}: Props) {
  const { showToast } = useToast();
  const capture = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      showToast('Camera permission is required to take this photo', 'error');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.85 });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      const stablePath = await newPhotoFilePath(recordId, filePrefix);
      await FileSystem.copyAsync({ from: result.assets[0].uri, to: stablePath });
      onCaptured(stablePath);
    }
  };

  return (
    <View>
      <Pressable style={styles.box} onPress={capture}>
        {photoPath ? (
          <Image source={{ uri: photoPath }} style={styles.image} resizeMode="contain" />
        ) : (
          <View style={styles.emptyState}>
            <MaterialIcons name="camera-alt" size={40} color={colors.textSecondary} />
            <Text style={styles.emptyText}>{emptyLabel}</Text>
          </View>
        )}
      </Pressable>
      <Pressable style={styles.button} onPress={capture}>
        <MaterialIcons name="camera-alt" size={20} color={colors.white} style={styles.buttonIcon} />
        <Text style={styles.buttonText}>{photoPath ? retakeLabel : takeLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    height: 200,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  image: { width: '100%', height: '100%' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.textSecondary, fontSize: 13, marginTop: 8 },
  button: {
    marginTop: 12,
    height: 48,
    borderRadius: 8,
    backgroundColor: colors.brandPrimary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonIcon: { marginRight: 8 },
  buttonText: { color: colors.white, fontWeight: '600', fontSize: 15 },
});
