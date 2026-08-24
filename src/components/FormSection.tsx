import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { colors } from '../theme';

interface Props {
  title?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Shared card wrapper grouping a related set of fields — same accent-bar-title/card visual
 *  language as RecordDetailView's Section, reused here so wizard forms get the same sense of
 *  structure instead of every field sitting flat on the plain background. Purely a visual
 *  grouping: it never reorders or omits the fields passed as children. */
export default function FormSection({ title, children, style }: Props) {
  return (
    <View style={[styles.card, style]}>
      {title ? (
        <View style={styles.header}>
          <View style={styles.accent} />
          <Text style={styles.title}>{title}</Text>
        </View>
      ) : null}
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    marginBottom: 16,
    elevation: 1,
    shadowColor: colors.black,
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 14, paddingBottom: 2 },
  accent: { width: 4, height: 16, borderRadius: 2, backgroundColor: colors.brandAccent, marginRight: 10 },
  title: { fontSize: 14, fontWeight: '700', color: colors.brandPrimary },
  body: { padding: 14, paddingTop: 8 },
});
