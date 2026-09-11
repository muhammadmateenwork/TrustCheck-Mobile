import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, TextInputProps } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme';

interface Props extends TextInputProps {
  label?: string;
  /** Matches the native TextInputLayout's app:startIconDrawable (used for the search fields on
   *  History and Admin — see fragment_history.xml / fragment_admin.xml). */
  startIcon?: keyof typeof MaterialIcons.glyphMap;
  /** Tappable icon at the right edge of the field — used for the password show/hide toggle on
   *  the Login screens. Purely presentational; the caller owns whatever state it's tied to (e.g.
   *  flipping its own `secureTextEntry` prop). */
  endIcon?: keyof typeof MaterialIcons.glyphMap;
  onEndIconPress?: () => void;
  /** Fixed, non-editable text glued to the left of the input's own value — e.g. a locked file
   *  name prefix the operator can't remove or type over. Purely presentational, like startIcon,
   *  but arbitrary text instead of a fixed-size icon, so it needs its own inline layout rather
   *  than startIcon's absolutely-positioned one (see the prefixText branch below). Not meant to
   *  be combined with startIcon/endIcon — no caller currently does, and this doesn't attempt to
   *  reconcile the two layouts. */
  prefixText?: string;
}

/** Shared text input matching the native app's TextInputLayout/TextInputEditText usage. The
 *  border highlighting on focus (absent before — every field looked identical whether or not it
 *  was the one currently being typed into) is the single biggest thing separating this from
 *  looking like a real native TextInputLayout, which always shows which field is active. */
export default function TextField({ label, style, startIcon, endIcon, onEndIconPress, prefixText, onFocus, onBlur, ...rest }: Props) {
  const [focused, setFocused] = useState(false);

  const handleFocus: Props['onFocus'] = (e) => {
    setFocused(true);
    onFocus?.(e);
  };
  const handleBlur: Props['onBlur'] = (e) => {
    setFocused(false);
    onBlur?.(e);
  };

  if (prefixText) {
    // A fixed-width absolutely-positioned label (startIcon's approach) doesn't work here since
    // prefixText's width varies with its content — laid out as a real flex row instead, with the
    // border/background moved onto that row and the TextInput itself left borderless.
    return (
      <View style={styles.container}>
        {label ? <Text style={styles.label}>{label}</Text> : null}
        <View style={[styles.prefixBox, focused && styles.inputFocused]}>
          <Text style={styles.prefixLabel}>{prefixText}</Text>
          <TextInput
            style={[styles.prefixInput, style]}
            placeholderTextColor={colors.textSecondary}
            onFocus={handleFocus}
            onBlur={handleBlur}
            {...rest}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.inputRow}>
        {startIcon && (
          <MaterialIcons
            name={startIcon}
            size={20}
            color={focused ? colors.brandPrimary : colors.textSecondary}
            style={styles.startIcon}
          />
        )}
        <TextInput
          style={[
            styles.input,
            focused && styles.inputFocused,
            startIcon && styles.inputWithIcon,
            endIcon && styles.inputWithEndIcon,
            style,
          ]}
          placeholderTextColor={colors.textSecondary}
          onFocus={handleFocus}
          onBlur={handleBlur}
          {...rest}
        />
        {endIcon && (
          <Pressable onPress={onEndIconPress} style={styles.endIcon} hitSlop={8}>
            <MaterialIcons name={endIcon} size={20} color={focused ? colors.brandPrimary : colors.textSecondary} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 16 },
  label: { fontSize: 13, color: colors.textSecondary, marginBottom: 6 },
  inputRow: { position: 'relative', justifyContent: 'center' },
  startIcon: { position: 'absolute', left: 12, zIndex: 1 },
  endIcon: { position: 'absolute', right: 12, zIndex: 1 },
  input: {
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  inputFocused: {
    borderColor: colors.brandPrimary,
    borderWidth: 1.5,
  },
  inputWithIcon: { paddingLeft: 40 },
  inputWithEndIcon: { paddingRight: 40 },
  prefixBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 8,
    paddingLeft: 12,
    backgroundColor: colors.surface,
  },
  prefixLabel: { fontSize: 15, fontWeight: '600', color: colors.textSecondary },
  prefixInput: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.textPrimary,
  },
});
