import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet, PanResponder } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import * as FileSystem from 'expo-file-system/legacy';
import { colors } from '../theme';

export interface SignaturePadHandle {
  isEmpty: () => boolean;
  /** True the moment a new stroke has been drawn since mount (or since the last clear()) — as
   *  opposed to isEmpty()===false purely because `initialFilePath` preloaded an existing
   *  signature with no new strokes on top of it. Callers use this to decide whether there's
   *  actually anything new to capture: re-capturing (screenshotting) the pad when nothing was
   *  redrawn just re-encodes the preloaded image at the pad's on-screen resolution, degrading it
   *  a little more on every Back/Next round trip. */
  hasUnsavedChanges: () => boolean;
  clear: () => void;
  /** Saves the current signature as a PNG to `path`, resolving once the write completes. */
  saveToFile: (path: string) => Promise<void>;
}

interface Props {
  /** Existing signature to preload (e.g. resuming a draft), as a local file path. */
  initialFilePath?: string | null;
  onChanged?: (hasSignature: boolean) => void;
  /** Fires true the instant a stroke starts and false once it ends — the pad sits inside a
   *  ScrollView on every screen that uses it. PanResponder's *Capture handlers already claim the
   *  gesture ahead of the ScrollView on their own, but this stays wired up as a belt-and-suspenders
   *  guard against the pad ever appearing to shift mid-signature. */
  onDrawStateChange?: (isDrawing: boolean) => void;
}

type Point = { x: number; y: number };

function pointsToPathData(points: Point[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    // A tap with no movement — draw a short segment so a single dot isn't invisible.
    const p = points[0];
    return `M${p.x - 0.4},${p.y} L${p.x + 0.4},${p.y}`;
  }
  return points.reduce((d, p, i) => d + (i === 0 ? `M${p.x},${p.y}` : ` L${p.x},${p.y}`), '');
}

/**
 * Shared signature pad, functionally matching the native app's custom SignatureView (touch-path
 * drawing, isEmpty()/clear()/saveToFile()/loadFromFile()). Draws directly with react-native-svg
 * via raw touch tracking (PanResponder) and captures the rendered view to a PNG with
 * react-native-view-shot.
 *
 * This replaces an earlier WebView-hosted-canvas implementation (react-native-signature-canvas):
 * despite tuning the WebView's Android layer type, that approach still produced visibly blurry,
 * imprecise-feeling signatures on a real device. Drawing natively with SVG sidesteps the whole
 * WebView rendering pipeline — strokes are plotted from the exact same touch coordinates React
 * Native itself reports, and the exported PNG is a direct capture of the real rendered pixels, not
 * a re-encoded browser canvas bitmap at some other resolution.
 */
const SignaturePad = forwardRef<SignaturePadHandle, Props>(({ initialFilePath, onChanged, onDrawStateChange }, ref) => {
  const containerRef = useRef<View>(null);
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const [hasExistingImage, setHasExistingImage] = useState(!!initialFilePath);
  const [hasSignature, setHasSignature] = useState(!!initialFilePath);

  const updateHasSignature = (value: boolean) => {
    setHasSignature(value);
    onChanged?.(value);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        setStrokes((prev) => [...prev, [{ x: locationX, y: locationY }]]);
        updateHasSignature(true);
        onDrawStateChange?.(true);
      },
      onPanResponderMove: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        setStrokes((prev) => {
          if (prev.length === 0) return prev;
          const lastStroke = prev[prev.length - 1];
          const lastPoint = lastStroke[lastStroke.length - 1];
          if (lastPoint) {
            const dx = locationX - lastPoint.x;
            const dy = locationY - lastPoint.y;
            if (dx * dx + dy * dy < 4) return prev; // sub-2px jitter — skip to keep the path cheap and smooth
          }
          const next = prev.slice(0, -1);
          next.push([...lastStroke, { x: locationX, y: locationY }]);
          return next;
        });
      },
      onPanResponderRelease: () => onDrawStateChange?.(false),
      onPanResponderTerminate: () => onDrawStateChange?.(false),
    })
  ).current;

  useImperativeHandle(ref, () => ({
    isEmpty: () => !hasSignature,
    hasUnsavedChanges: () => strokes.length > 0,
    clear: () => {
      setStrokes([]);
      setHasExistingImage(false);
      updateHasSignature(false);
    },
    saveToFile: async (path: string) => {
      const tmpUri = await captureRef(containerRef, { format: 'png', quality: 1, result: 'tmpfile' });
      await FileSystem.copyAsync({ from: tmpUri, to: path });
    },
  }));

  const showHint = !hasExistingImage && strokes.length === 0;

  return (
    <View style={styles.wrapper}>
      <View ref={containerRef} style={styles.canvas} collapsable={false} {...panResponder.panHandlers}>
        {hasExistingImage && initialFilePath && (
          <Image source={{ uri: initialFilePath }} style={StyleSheet.absoluteFill} resizeMode="contain" />
        )}
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          {strokes.map((stroke, i) => (
            <Path
              key={i}
              d={pointsToPathData(stroke)}
              stroke={colors.textPrimary}
              strokeWidth={2.5}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </Svg>
      </View>
      {showHint && (
        <View style={styles.hintOverlay} pointerEvents="none">
          <Text style={styles.hintText}>Sign here</Text>
        </View>
      )}
    </View>
  );
});

SignaturePad.displayName = 'SignaturePad';
export default SignaturePad;

const styles = StyleSheet.create({
  wrapper: {
    height: 180,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  canvas: { flex: 1 },
  hintOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  hintText: { color: colors.textSecondary, fontSize: 13 },
});
