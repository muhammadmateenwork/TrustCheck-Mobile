import React from 'react';
import { Pressable, Text, View, StyleSheet, ActivityIndicator, StyleProp, ViewStyle } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme';

interface Props {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** 'danger' is a solid, brand_danger-filled button — matches native's own MaterialButton
   *  app:backgroundTint="@color/brand_danger" on destructive actions (e.g. Delete Operator),
   *  deliberately not the plain text-link treatment those got before, which read as far less
   *  serious than a permanent account deletion actually is. */
  variant?: 'primary' | 'outlined' | 'text' | 'danger';
  /** Matches the native MaterialButton's app:icon — e.g. "add" for + New Test / Add Operator,
   *  "qr-code-scanner" for Scan QR. Optional since most buttons are text-only. */
  icon?: keyof typeof MaterialIcons.glyphMap;
  /** Icon rendered after the label instead of before it — e.g. "arrow-forward" on wizard Next
   *  buttons, so the direction of travel reads visually instead of every button looking the same
   *  regardless of whether it moves forward or back. */
  trailingIcon?: keyof typeof MaterialIcons.glyphMap;
  style?: StyleProp<ViewStyle>;
}

/** Shared button matching the native app's MaterialButton styles (filled/outlined/text/danger). */
export default function Button({ title, onPress, disabled, loading, variant = 'primary', icon, trailingIcon, style }: Props) {
  const isDisabled = disabled || loading;
  const iconColor = variant === 'primary' || variant === 'danger' ? colors.white : colors.brandPrimary;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && styles.primary,
        variant === 'outlined' && styles.outlined,
        variant === 'text' && styles.text,
        variant === 'danger' && styles.danger,
        (variant === 'primary' || variant === 'danger') && styles.elevated,
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={iconColor} />
      ) : (
        <View style={styles.content}>
          {icon && <MaterialIcons name={icon} size={20} color={iconColor} style={styles.icon} />}
          <Text
            style={[
              styles.label,
              (variant === 'primary' || variant === 'danger') && styles.labelPrimary,
              (variant === 'outlined' || variant === 'text') && styles.labelOutlined,
            ]}
          >
            {title}
          </Text>
          {trailingIcon && <MaterialIcons name={trailingIcon} size={20} color={iconColor} style={styles.trailingIcon} />}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 52,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primary: { backgroundColor: colors.brandPrimary },
  outlined: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.brandPrimary },
  text: { backgroundColor: 'transparent', height: 44 },
  danger: { backgroundColor: colors.brandDanger },
  elevated: {
    elevation: 2,
    shadowColor: colors.black,
    shadowOpacity: 0.15,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  content: { flexDirection: 'row', alignItems: 'center' },
  icon: { marginRight: 8 },
  trailingIcon: { marginLeft: 8 },
  label: { fontSize: 16, fontWeight: '600' },
  labelPrimary: { color: colors.white },
  labelOutlined: { color: colors.brandPrimary },
});
