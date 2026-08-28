import React from 'react';
import { StyleSheet } from 'react-native';
import { KeyboardAwareScrollView, KeyboardAwareScrollViewProps } from 'react-native-keyboard-aware-scroll-view';

/** IS the screen's scrollable content container (not a wrapper around a separate ScrollView) —
 *  replaces what used to be `<KeyboardAvoidingScreen><ScrollView ...>...</ScrollView></KeyboardAvoidingScreen>`
 *  with just `<KeyboardAvoidingScreen ...same ScrollView props.../>`.
 *
 *  The previous version only resized the available space when the keyboard opened (via a plain
 *  RN `KeyboardAvoidingView`, relying on Android's own `adjustResize` window mode to do the same
 *  job there — see this file's own git history for that reasoning). That solved a DIFFERENT
 *  problem than the one actually reported: resizing the viewport does nothing to scroll a
 *  currently-focused TextInput INTO that now-smaller viewport if it happens to be lower on the
 *  screen than the new keyboard-shrunk bottom edge — nothing was actually moving the scroll
 *  position, so a field being typed into could sit right behind the keyboard the whole time.
 *  `KeyboardAwareScrollView` (from react-native-keyboard-aware-scroll-view — chosen specifically
 *  because it has no react-native-reanimated peer dependency, unlike the more modern
 *  react-native-keyboard-controller, which would have pulled in a reanimated version requiring a
 *  newer React Native than this project is on, and a second worklets runtime alongside the one
 *  react-native-vision-camera's frame processor already depends on) tracks which TextInput is
 *  focused and actively scrolls to keep it visible above the keyboard, which is the actual fix.
 *
 *  `enableOnAndroid` is explicitly turned on here because the library defaults it off (assuming
 *  Android's own window resize is "enough" — which is exactly the assumption that didn't hold
 *  for a scrollable form here).
 *
 *  `StyleSheet.flatten` on `contentContainerStyle` works around a real bug in this library's own
 *  render(): whenever enableOnAndroid is on, it recomputes the container's paddingBottom via a
 *  bare `(contentContainerStyle || {}).paddingBottom` read (see its own KeyboardAwareHOC.js) --
 *  which only works if contentContainerStyle is a plain object. Every screen here passes an ARRAY
 *  (`[styles.container, { paddingBottom: 20 + insets.bottom }]`, the normal RN style-composition
 *  pattern), and arrays don't have a `.paddingBottom` property, so that read silently evaluates to
 *  undefined -> 0. The library then appends its own `{ paddingBottom: 0 + keyboardSpace }` as the
 *  LAST entry in a new array, which (later entries win when RN flattens a style array) overwrites
 *  the real safe-area padding with 0 the instant the keyboard is closed -- confirmed via reading
 *  the library's source, not guessed, and it's exactly why bottom buttons ended up flush against
 *  the screen edge (worse on phones with a larger gesture-nav bar, since there was more inset
 *  being wiped out to begin with). Flattening here first gives the library one real plain object
 *  with a real .paddingBottom it can actually read and add to, instead of losing it. */
export default function KeyboardAvoidingScreen({ contentContainerStyle, ...props }: KeyboardAwareScrollViewProps) {
  return (
    <KeyboardAwareScrollView
      enableOnAndroid
      extraScrollHeight={20}
      keyboardOpeningTime={0}
      contentContainerStyle={StyleSheet.flatten(contentContainerStyle)}
      {...props}
    />
  );
}
