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
}

/** Shared text input matching the native app's TextInputLayout/TextInputEditText usage. The
 *  border highlighting on focus (absent before — every field looked identical whether or not it
 *  was the one currently being typed into) is the single biggest thing separating this from
 *  looking like a real native TextInputLayout, which always shows which field is active. */
export default function TextField({ label, style, startIcon, endIcon, onEndIconPress, onFocus, onBlur, ...rest }: Props) {
  const [focused, setFocused] = useState(false);
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
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
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
});
