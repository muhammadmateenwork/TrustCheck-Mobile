import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ResultValue } from '../models/ResultValue';
import { colors } from '../theme';

/** Mirrors bg_badge_negative/nonnegative/neutral + the color choices in HistoryAdapter.java. */
export default function Badge({ text, result }: { text: string; result: string | null }) {
  let bg = '#EEF1F2';
  let fg = colors.textSecondary;
  if (result === ResultValue.NEGATIVE) {
    bg = '#E5F3E6';
    fg = colors.brandSuccess;
  } else if (result === ResultValue.NON_NEGATIVE) {
    bg = '#FBEAEA';
    fg = colors.brandDanger;
  }
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.text, { color: fg }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginRight: 8 },
  text: { fontSize: 11, fontWeight: '600' },
});
