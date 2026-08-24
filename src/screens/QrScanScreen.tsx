import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { CameraView, useCameraPermissions, BarcodeScanningResult } from 'expo-camera';
import { MaterialIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'QrScan'>;

/**
 * Mirrors QrScanActivity.java — a dedicated camera screen for scanning a test kit's QR/Data
 * Matrix/Aztec code. Delivers the raw scanned text back to TestKitScreen by navigating back to
 * it with a merged param update (React Navigation params must stay serializable, so this is used
 * instead of a callback prop — see types.ts's own note on TestKit's params) — the RN equivalent
 * of the native ActivityResultLauncher round trip.
 */
export default function QrScanScreen({ navigation }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const delivered = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted) {
      void requestPermission();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission]);

  const onScanned = (result: BarcodeScanningResult) => {
    if (delivered.current) return;
    delivered.current = true;
    navigation.navigate({
      name: 'TestKit',
      params: { scannedQrRaw: result.data, scannedAt: Date.now() },
      merge: true,
    });
  };

  if (!permission) return null;
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionText}>Camera permission is required to scan the QR code</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr', 'datamatrix', 'aztec'] }}
        onBarcodeScanned={onScanned}
      />
      <Pressable style={styles.closeButton} onPress={() => navigation.goBack()}>
        <MaterialIcons name="close" size={22} color={colors.white} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.black },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  permissionText: { color: colors.textPrimary, textAlign: 'center' },
  closeButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
