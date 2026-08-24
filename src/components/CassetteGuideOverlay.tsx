import React from 'react';
import { View, StyleSheet } from 'react-native';
import { GUIDE_ASPECT_RATIO } from '../models/CassetteTemplate';
import { colors } from '../theme';

export interface GuideRectFraction {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Computes the guide rectangle as a fraction (0-1) of the camera frame — mirrors
 *  CassetteGuideOverlayView.java's onSizeChanged(): 85% of frame width, capped so its height
 *  (per GUIDE_ASPECT_RATIO) never exceeds 45% of frame height, centered. Pure function so both
 *  the overlay (below) and the post-capture crop (DrugCassetteScanScreen) use the exact same
 *  math — there's only one camera frame here (unlike the native app, this component's own
 *  container IS sized to exactly the camera frame's letterboxed bounds, see that screen), so no
 *  separate "camera frame within a bigger view" step is needed the way the native version has. */
export function computeGuideRectFraction(): GuideRectFraction {
  let guideWidthFrac = 0.85;
  let guideHeightFrac = guideWidthFrac / GUIDE_ASPECT_RATIO;
  if (guideHeightFrac > 0.45) {
    guideHeightFrac = 0.45;
    guideWidthFrac = guideHeightFrac * GUIDE_ASPECT_RATIO;
  }
  const left = (1 - guideWidthFrac) / 2;
  const top = (1 - guideHeightFrac) / 2;
  return { left, top, right: left + guideWidthFrac, bottom: top + guideHeightFrac };
}

/** How much wider than the on-screen guide box the actual search area handed to the analyzer is,
 *  in each dimension. The guide box is still shown as an AIMING reference (the operator centers
 *  the cassette on it), but the analyzer no longer assumes the reading window fills it exactly —
 *  see cassetteAnalyzerHtml.ts#cropAndAnalyze's multi-scale/rotation search, which needs real
 *  surrounding context to find a cassette that's smaller (farther away), larger (closer), or
 *  tilted relative to what the guide box alone would capture. */
const SEARCH_EXPANSION = 1.8;

/** The wider crop actually handed to the analyzer — computeGuideRectFraction() expanded by
 *  SEARCH_EXPANSION around the same center, clamped to the frame. Kept separate from the guide
 *  box shown on screen (which stays a tight aiming reference) so the operator's on-screen
 *  experience doesn't change, only how much context the search underneath actually gets to work
 *  with. */
export function computeSearchRectFraction(): GuideRectFraction {
  const guide = computeGuideRectFraction();
  const guideWidthFrac = guide.right - guide.left;
  const guideHeightFrac = guide.bottom - guide.top;
  const centerX = (guide.left + guide.right) / 2;
  const centerY = (guide.top + guide.bottom) / 2;

  const searchWidthFrac = Math.min(1, guideWidthFrac * SEARCH_EXPANSION);
  const searchHeightFrac = Math.min(1, guideHeightFrac * SEARCH_EXPANSION);

  let left = centerX - searchWidthFrac / 2;
  let right = centerX + searchWidthFrac / 2;
  if (left < 0) { right -= left; left = 0; }
  if (right > 1) { left -= right - 1; right = 1; }

  let top = centerY - searchHeightFrac / 2;
  let bottom = centerY + searchHeightFrac / 2;
  if (top < 0) { bottom -= top; top = 0; }
  if (bottom > 1) { top -= bottom - 1; bottom = 1; }

  return { left: clamp01(left), top: clamp01(top), right: clamp01(right), bottom: clamp01(bottom) };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Draws the alignment guide the operator frames the cassette's result window within — a scrim
 *  over everything except a cutout rectangle, with corner brackets. Mirrors
 *  CassetteGuideOverlayView.java's onDraw(). Must be rendered as an absolutely-positioned
 *  overlay exactly matching the CameraView's own bounds (see DrugCassetteScanScreen), which is
 *  what makes `frac` (from computeGuideRectFraction) apply identically to both what's drawn here
 *  and what's cropped out of the captured photo afterward. */
export default function CassetteGuideOverlay({ width, height }: { width: number; height: number }) {
  const frac = computeGuideRectFraction();
  const guideLeft = frac.left * width;
  const guideTop = frac.top * height;
  const guideWidth = (frac.right - frac.left) * width;
  const guideHeight = (frac.bottom - frac.top) * height;
  const bracket = Math.min(guideWidth, guideHeight) * 0.18;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[styles.scrim, { top: 0, left: 0, right: 0, height: guideTop }]} />
      <View style={[styles.scrim, { top: guideTop + guideHeight, left: 0, right: 0, bottom: 0 }]} />
      <View style={[styles.scrim, { top: guideTop, left: 0, width: guideLeft, height: guideHeight }]} />
      <View style={[styles.scrim, { top: guideTop, left: guideLeft + guideWidth, right: 0, height: guideHeight }]} />

      <View style={[styles.border, { left: guideLeft, top: guideTop, width: guideWidth, height: guideHeight }]} />

      {/* Corner brackets */}
      <View style={[styles.bracketH, { left: guideLeft, top: guideTop, width: bracket }]} />
      <View style={[styles.bracketV, { left: guideLeft, top: guideTop, height: bracket }]} />
      <View style={[styles.bracketH, { left: guideLeft + guideWidth - bracket, top: guideTop, width: bracket }]} />
      <View style={[styles.bracketV, { left: guideLeft + guideWidth, top: guideTop, height: bracket }]} />
      <View style={[styles.bracketH, { left: guideLeft, top: guideTop + guideHeight, width: bracket }]} />
      <View style={[styles.bracketV, { left: guideLeft, top: guideTop + guideHeight - bracket, height: bracket }]} />
      <View
        style={[styles.bracketH, { left: guideLeft + guideWidth - bracket, top: guideTop + guideHeight, width: bracket }]}
      />
      <View
        style={[styles.bracketV, { left: guideLeft + guideWidth, top: guideTop + guideHeight - bracket, height: bracket }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.67)' },
  border: { position: 'absolute', borderWidth: 1.5, borderColor: colors.white },
  bracketH: { position: 'absolute', height: 4, backgroundColor: colors.brandAccent, borderRadius: 2 },
  bracketV: { position: 'absolute', width: 4, backgroundColor: colors.brandAccent, borderRadius: 2 },
});
