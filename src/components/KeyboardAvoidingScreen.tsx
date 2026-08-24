import React from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, ViewStyle } from 'react-native';

/** Keeps whatever TextField currently has focus from ending up hidden behind the keyboard —
 *  wraps a screen's whole content (ScrollView, bottom bar, everything) so the bottom bar rides up
 *  along with the rest rather than staying pinned under the keyboard on its own. Previously only
 *  wired up on the two Login screens even though most form screens in the app have text fields.
 *
 *  No `behavior` (and no manual offset) on Android: Expo's default `androidStatusBarStyle`/window
 *  setup already runs in `adjustResize` mode, which resizes the whole window itself whenever the
 *  keyboard opens — the OS is already doing the same job KeyboardAvoidingView's own `"height"`
 *  behavior tries to do a second time on top of it. Layering both was the cause of a real bug:
 *  bottom-bar buttons ending up flush against the screen edge (ignoring the safe-area bottom
 *  inset entirely) specifically right after the keyboard closed, from the two resize mechanisms
 *  disagreeing about the view's final height at that moment. iOS has no OS-level equivalent, so it
 *  still needs `"padding"` here. */
export default function KeyboardAvoidingScreen({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <KeyboardAvoidingView
      style={[styles.flex, style]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
