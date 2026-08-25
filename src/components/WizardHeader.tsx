import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme';

const TOTAL_WIZARD_STEPS = 8;

/** Shared heading for each of the 8 linear wizard screens (Donor Data through Sign-off, then
 *  Summary as the completion screen outside the count) — the screen's own title plus a slim
 *  step-progress bar, so a long multi-screen form flow gives the operator a constant sense of how
 *  much is left instead of feeling like an open-ended stack of forms. Sits as the first child
 *  inside each screen's existing ScrollView content in place of a plain title Text — purely
 *  additive, no layout restructuring needed. */
export default function WizardHeader({ title, step }: { title: string; step: number }) {
  return (
    <View style={styles.container}>
      <View style={styles.progressRow}>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${(step / TOTAL_WIZARD_STEPS) * 100}%` }]} />
        </View>
        <Text style={styles.stepLabel}>
          {step}/{TOTAL_WIZARD_STEPS}
        </Text>
      </View>
      <Text style={styles.title}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 16 },
  progressRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  track: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.divider, overflow: 'hidden', marginRight: 8 },
  fill: { height: '100%', backgroundColor: colors.brandAccent, borderRadius: 2 },
  stepLabel: { fontSize: 11, fontWeight: '700', color: colors.textSecondary },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
});
