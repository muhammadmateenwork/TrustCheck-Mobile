import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors } from '../theme';

export interface RadioOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: RadioOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  horizontal?: boolean;
}

/** Shared single-select radio group, matching the native app's pervasive use of RadioGroup for
 *  results, filters, and yes/no answers. */
export default function RadioGroup<T extends string>({ options, value, onChange, horizontal }: Props<T>) {
  return (
    <View style={horizontal ? styles.rowHorizontal : styles.rowVertical}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            style={[styles.option, horizontal && styles.optionHorizontal]}
            onPress={() => onChange(opt.value)}
          >
            <View style={[styles.dot, selected && styles.dotSelected]}>
              {selected && <View style={styles.dotInner} />}
            </View>
            <Text style={styles.label}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  rowVertical: { flexDirection: 'column' },
  rowHorizontal: { flexDirection: 'row', flexWrap: 'wrap' },
  option: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  optionHorizontal: { marginRight: 20 },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  dotSelected: { borderColor: colors.brandPrimary },
  dotInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brandPrimary },
  label: { fontSize: 14, color: colors.textPrimary },
});
