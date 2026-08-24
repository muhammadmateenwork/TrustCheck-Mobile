import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme';

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  children?: React.ReactNode;
}

/** Shared checkbox row matching the native app's CheckBox usage — a box plus a label, with an
 *  optional trailing inline element (e.g. a "Privacy Statement" link) via children. */
export default function Checkbox({ checked, onChange, label, children }: Props) {
  return (
    <Pressable style={styles.row} onPress={() => onChange(!checked)}>
      <View style={[styles.box, checked && styles.boxChecked]}>
        {checked && <MaterialIcons name="check" size={16} color={colors.white} />}
      </View>
      <Text style={styles.label}>
        {label}
        {children}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  box: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.textSecondary,
    marginRight: 10,
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  label: { flex: 1, fontSize: 13, color: colors.textPrimary, lineHeight: 18 },
});
