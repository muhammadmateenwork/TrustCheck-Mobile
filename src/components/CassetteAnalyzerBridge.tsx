import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';
import { CASSETTE_ANALYZER_HTML } from './cassetteAnalyzerHtml';
import { CassetteReading } from '../models/CassetteReading';
import { GuideRectFraction } from './CassetteGuideOverlay';

export interface CropAndAnalyzeResult {
  reading: CassetteReading | null;
}

export interface CassetteAnalyzerHandle {
  /** Reads the JPEG at `localUri`, crops it to `searchFraction` (the wide area to search within —
   *  see CassetteGuideOverlay#computeSearchRectFraction, deliberately bigger than the on-screen
   *  guide box) and searches that crop for the cassette inside the hidden WebView (see
   *  cassetteAnalyzerHtml.ts#searchAndAnalyze) purely to read the result — `localUri` itself is
   *  left untouched. The tight, possibly-rotated/rescaled sub-crop the search actually locked
   *  onto is only ever used internally to read the lines; the full photo the operator actually
   *  took is what stays saved and is what shows up in History, Admin, and the PDF report, per
   *  explicit product direction (an earlier version overwrote localUri with that internal crop,
   *  which meant the "saved" cassette photo could end up a tightly zoomed, sometimes rotated
   *  sliver of the original capture instead of the complete photo). */
  cropAndAnalyze: (localUri: string, searchFraction: GuideRectFraction) => Promise<CropAndAnalyzeResult>;
}

interface PendingRequest {
  resolve: (result: { reading: CassetteReading | null }) => void;
}

let requestCounter = 0;

/** Hidden WebView hosting the pixel-analysis script — see cassetteAnalyzerHtml.ts for why a
 *  WebView canvas is used (real getImageData() pixel access without a custom native module). */
const CassetteAnalyzerBridge = forwardRef<CassetteAnalyzerHandle>((_props, ref) => {
  const webViewRef = useRef<WebView>(null);
  const pending = useRef<Map<number, PendingRequest>>(new Map());

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as {
        type: string;
        requestId: number | null;
        reading?: CassetteReading;
      };
      if (data.requestId == null) return;
      const request = pending.current.get(data.requestId);
      if (!request) return;
      pending.current.delete(data.requestId);
      if (data.type === 'result') {
        request.resolve({ reading: data.reading ?? null });
      } else {
        request.resolve({ reading: null });
      }
    } catch {
      // Malformed message — nothing to resolve against.
    }
  };

  useImperativeHandle(ref, () => ({
    cropAndAnalyze: async (localUri: string, searchFraction: GuideRectFraction) => {
      try {
        const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
        const requestId = ++requestCounter;
        const { reading } = await new Promise<{ reading: CassetteReading | null }>((resolve) => {
          pending.current.set(requestId, { resolve });
          webViewRef.current?.postMessage(
            JSON.stringify({
              type: 'analyze',
              requestId,
              imageBase64: `data:image/jpeg;base64,${base64}`,
              searchFraction,
            })
          );
          // Wider than native tryAnalyze()'s implicit few-second bound — searchAndAnalyze() now
          // runs the analysis pipeline across a whole grid of rotation/scale candidates instead
          // of once, so it legitimately needs more time on a slower device. Still bounded so the
          // WebView never responding doesn't hang forever.
          setTimeout(() => {
            if (pending.current.has(requestId)) {
              pending.current.delete(requestId);
              resolve({ reading: null });
            }
          }, 15000);
        });

        return { reading };
      } catch {
        return { reading: null };
      }
    },
  }));

  return (
    <WebView
      ref={webViewRef}
      source={{ html: CASSETTE_ANALYZER_HTML }}
      onMessage={onMessage}
      style={styles.hidden}
      javaScriptEnabled
    />
  );
});

CassetteAnalyzerBridge.displayName = 'CassetteAnalyzerBridge';
export default CassetteAnalyzerBridge;

const styles = StyleSheet.create({
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0 },
});
