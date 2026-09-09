import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, ActivityIndicator } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { PDF_VIEWER_HTML } from './pdfViewerHtml';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'PdfViewer'>;

/**
 * Mirrors PdfViewerActivity.java — an in-app PDF viewer used for every report the app shows an
 * operator/admin, deliberately not "hand off to whatever PDF app is installed." There's no
 * share/export affordance anywhere on this screen.
 *
 * Rendering went through three approaches before landing here — see pdfViewerHtml.ts's own doc
 * for the full account of why a raw file:// source, a content:// source, and a base64 data: URI
 * source were each dead ends on-device (ERR_ACCESS_DENIED for the first two — one setting
 * confirmed-unfixable in this react-native-webview version, the other confirmed still broken with
 * the flag enabled; the data: URI stalled silently past Android WebView's practical length ceiling
 * for a photo-heavy PDF). This loads a small static HTML shell (always allowed — it's not a
 * file/content/oversized-data navigation at all) and delivers the PDF's bytes into it over
 * postMessage, where an in-page Blob URL renders it.
 */
export default function PdfViewerScreen({ route }: Props) {
  const { pdfPath } = route.params;
  const webViewRef = useRef<WebView>(null);
  const [hintOpacity] = useState(new Animated.Value(0));
  const [showHint, setShowHint] = useState(false);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [webviewReady, setWebviewReady] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setPdfBase64(null);
    setRendered(false);
    setLoadError(null);
    (async () => {
      try {
        // expo-file-system's own path helpers (FileSystem.documentDirectory/cacheDirectory) are
        // themselves file:// URIs, and getInfoAsync/readAsStringAsync expect that full URI back —
        // NOT a bare filesystem path. A previous version of this screen stripped the file://
        // prefix off before these calls, which made getInfoAsync report a real, just-generated
        // PDF as not existing every time.
        const path = pdfPath.startsWith('file://') ? pdfPath : `file://${pdfPath}`;
        const info = await FileSystem.getInfoAsync(path);
        if (!info.exists) {
          setLoadError('This report could not be found — it may need to be regenerated.');
          return;
        }
        const base64 = await FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.Base64 });
        console.log('[PdfViewer] read', base64.length, 'base64 chars');
        setPdfBase64(base64);
      } catch (e) {
        console.log('[PdfViewer] threw', e);
        setLoadError(`Could not open report: ${(e as Error).message}`);
      }
    })();
  }, [pdfPath]);

  // Sends the PDF bytes in only once BOTH sides are ready: the file has been read (pdfBase64) and
  // the WebView's own script has attached its message listener (webviewReady, signaled by the
  // page's own 'ready' postMessage) — posting before the listener exists would silently drop it.
  useEffect(() => {
    if (pdfBase64 && webviewReady) {
      webViewRef.current?.postMessage(pdfBase64);
    }
  }, [pdfBase64, webviewReady]);

  const onWebViewMessage = (event: WebViewMessageEvent) => {
    const data = event.nativeEvent.data;
    console.log('[PdfViewer] webview message:', data.length > 40 ? data.slice(0, 40) + '…' : data);
    if (data === 'ready') {
      setWebviewReady(true);
    } else if (data === 'rendered') {
      setRendered(true);
      // The zoom gesture has no on-screen affordance — briefly showing what to do, once, right
      // when the report first appears, is what makes it discoverable.
      setShowHint(true);
      Animated.sequence([
        Animated.timing(hintOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.delay(2200),
        Animated.timing(hintOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]).start(() => setShowHint(false));
    } else if (data.startsWith('error:')) {
      setLoadError(`Could not open report: ${data.slice('error:'.length)}`);
    }
  };

  if (loadError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{loadError}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ html: PDF_VIEWER_HTML }}
        style={styles.webview}
        onMessage={onWebViewMessage}
        onError={(e) => setLoadError(`Could not open report: ${e.nativeEvent.description}`)}
        originWhitelist={['*']}
        javaScriptEnabled
        // Android WebView's default hardware-accelerated layer composites canvas content through
        // a texture that isn't always pixel-exact with the screen — the same root cause behind an
        // earlier blur bug in the old WebView-based SignaturePad (fixed there the same way, before
        // that component was replaced entirely with native SVG). Forcing software rendering makes
        // the canvas pages PDF.js draws come out crisp instead of visibly soft.
        androidLayerType="software"
      />
      {!rendered && (
        <View style={[styles.center, StyleSheet.absoluteFill]} pointerEvents="none">
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      )}
      {showHint && (
        <Animated.View style={[styles.hint, { opacity: hintOpacity }]} pointerEvents="none">
          <Text style={styles.hintText}>Pinch to zoom</Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: 24 },
  errorText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
  webview: { flex: 1 },
  hint: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  hintText: { color: colors.white, fontSize: 13 },
});
