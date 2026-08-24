import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme';

type ResultValueType = 'NEGATIVE' | 'NON_NEGATIVE';

interface Props {
  value: ResultValueType | null;
  onChange: (value: ResultValueType) => void;
  negativeLabel?: string;
  nonNegativeLabel?: string;
  /** Smaller pill pair for per-substance rows, vs. the larger pair for the one overall result. */
  size?: 'large' | 'small';
}

/** A prominent two-way pill selector for a Negative/Non-Negative (or Pass/Fail) result — replaces
 *  plain radio dots for the result fields specifically, so the operator's actual answer reads at
 *  a glance instead of blending into the rest of the form. */
export default function ResultToggle({
  value,
  onChange,
  negativeLabel = 'Negative',
  nonNegativeLabel = 'Non-Negative',
  size = 'large',
}: Props) {
  const small = size === 'small';
  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => onChange('NEGATIVE')}
        style={[
          styles.pill,
          small && styles.pillSmall,
          styles.pillLeft,
          value === 'NEGATIVE' && styles.pillNegativeActive,
        ]}
      >
        {value === 'NEGATIVE' && (
          <MaterialIcons name="check-circle" size={small ? 14 : 18} color={colors.white} style={styles.icon} />
        )}
        <Text style={[styles.pillText, small && styles.pillTextSmall, value === 'NEGATIVE' && styles.pillTextActive]}>
          {negativeLabel}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => onChange('NON_NEGATIVE')}
        style={[
          styles.pill,
          small && styles.pillSmall,
          styles.pillRight,
          value === 'NON_NEGATIVE' && styles.pillNonNegativeActive,
        ]}
      >
        {value === 'NON_NEGATIVE' && (
          <MaterialIcons name="error" size={small ? 14 : 18} color={colors.white} style={styles.icon} />
        )}
        <Text
          style={[styles.pillText, small && styles.pillTextSmall, value === 'NON_NEGATIVE' && styles.pillTextActive]}
        >
          {nonNegativeLabel}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderWidth: 1.5,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
  },
  pillSmall: { height: 38 },
  pillLeft: { borderTopLeftRadius: 10, borderBottomLeftRadius: 10, borderRightWidth: 0.5 },
  pillRight: { borderTopRightRadius: 10, borderBottomRightRadius: 10, borderLeftWidth: 0.5 },
  pillNegativeActive: { backgroundColor: colors.brandSuccess, borderColor: colors.brandSuccess },
  pillNonNegativeActive: { backgroundColor: colors.brandDanger, borderColor: colors.brandDanger },
  icon: { marginRight: 6 },
  pillText: { fontSize: 15, fontWeight: '700', color: colors.textSecondary },
  pillTextSmall: { fontSize: 13 },
  pillTextActive: { color: colors.white },
});
