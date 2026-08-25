import React from 'react';
import { Modal, View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import RadioGroup, { RadioOption } from './RadioGroup';
import SelectField from './SelectField';
import DateField from './DateField';
import Button from './Button';
import { Sort, ResultOption } from '../models/HistoryFilter';
import { DateRange } from '../services/cloudSync';
import { colors } from '../theme';

const ALL_OPERATORS_LABEL = 'All operators';

function startOfDay(millis: number): number {
  const d = new Date(millis);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function endOfDay(millis: number): number {
  const d = new Date(millis);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function daysAgo(n: number): number {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.getTime();
}

const DATE_PRESETS: { label: string; range: () => DateRange }[] = [
  { label: 'Last 7 days', range: () => ({ fromMillis: startOfDay(daysAgo(6)), toMillis: endOfDay(Date.now()) }) },
  { label: 'Last 30 days', range: () => ({ fromMillis: startOfDay(daysAgo(29)), toMillis: endOfDay(Date.now()) }) },
  {
    label: 'This month',
    range: () => {
      const now = new Date();
      return { fromMillis: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), toMillis: endOfDay(Date.now()) };
    },
  },
  {
    label: 'Last month',
    range: () => {
      const now = new Date();
      const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastOfPrevMonth = new Date(firstOfThisMonth.getTime() - 1);
      const firstOfPrevMonth = new Date(lastOfPrevMonth.getFullYear(), lastOfPrevMonth.getMonth(), 1);
      return { fromMillis: firstOfPrevMonth.getTime(), toMillis: endOfDay(lastOfPrevMonth.getTime()) };
    },
  },
];

const SORT_OPTIONS: RadioOption<Sort>[] = [
  { value: 'NEWEST_FIRST', label: 'Newest first' },
  { value: 'OLDEST_FIRST', label: 'Oldest first' },
  { value: 'NAME_A_Z', label: 'Donor name (A–Z)' },
  { value: 'NAME_Z_A', label: 'Donor name (Z–A)' },
];

const RESULT_OPTIONS = (allLabel: string, negLabel: string, nonNegLabel: string): RadioOption<ResultOption>[] => [
  { value: 'ALL', label: allLabel },
  { value: 'NEGATIVE_OR_PASS', label: negLabel },
  { value: 'NON_NEGATIVE_OR_FAIL', label: nonNegLabel },
];

interface Props {
  visible: boolean;
  sort: Sort;
  drugFilter: ResultOption;
  alcoholFilter: ResultOption;
  /** Admin-only — omit entirely for History's usage (which has no operator filter, matching
   *  dialog_history_filter.xml). When provided, a "Filter by operator" dropdown is rendered first,
   *  matching dialog_admin_record_filter.xml's field order exactly. */
  operatorEmails?: string[];
  operatorFilterEmail?: string | null;
  /** Admin-only, same gate as operatorEmails — a server-side syncedAt range applied in
   *  fetchAllRecordsPage, not a client-side filter like sort/drug/alcohol above. */
  dateRange?: DateRange | null;
  onCancel: () => void;
  onReset: () => void;
  onApply: (
    sort: Sort,
    drugFilter: ResultOption,
    alcoholFilter: ResultOption,
    operatorFilterEmail?: string | null,
    dateRange?: DateRange | null
  ) => void;
}

/** Mirrors dialog_history_filter.xml / dialog_admin_record_filter.xml + the shared filter dialog
 *  logic in HistoryFragment.java / AdminFragment.java. */
export default function FilterModal({
  visible,
  sort,
  drugFilter,
  alcoholFilter,
  operatorEmails,
  operatorFilterEmail,
  dateRange,
  onCancel,
  onReset,
  onApply,
}: Props) {
  const [localSort, setLocalSort] = React.useState(sort);
  const [localDrug, setLocalDrug] = React.useState(drugFilter);
  const [localAlcohol, setLocalAlcohol] = React.useState(alcoholFilter);
  const operatorFilterToLabel = (email: string | null | undefined) => email ?? ALL_OPERATORS_LABEL;

  const [localOperator, setLocalOperator] = React.useState(operatorFilterToLabel(operatorFilterEmail));
  const [localDateRange, setLocalDateRange] = React.useState<DateRange | null>(dateRange ?? null);

  React.useEffect(() => {
    if (visible) {
      setLocalSort(sort);
      setLocalDrug(drugFilter);
      setLocalAlcohol(alcoholFilter);
      setLocalOperator(operatorFilterToLabel(operatorFilterEmail));
      setLocalDateRange(dateRange ?? null);
    }
  }, [visible, sort, drugFilter, alcoholFilter, operatorFilterEmail, dateRange]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Filter and sort</Text>
          <ScrollView>
            {operatorEmails && (
              <>
                <Text style={styles.sectionLabel}>Filter by operator</Text>
                <SelectField
                  label=""
                  value={localOperator}
                  options={[ALL_OPERATORS_LABEL, ...operatorEmails]}
                  onChange={setLocalOperator}
                />
              </>
            )}

            <Text style={styles.sectionLabel}>Sort by</Text>
            <RadioGroup options={SORT_OPTIONS} value={localSort} onChange={setLocalSort} />

            <Text style={styles.sectionLabel}>Drug Test Result</Text>
            <RadioGroup
              options={RESULT_OPTIONS('All', 'Negative', 'Non-Negative')}
              value={localDrug}
              onChange={setLocalDrug}
            />

            <Text style={styles.sectionLabel}>Alcohol Test Result</Text>
            <RadioGroup
              options={RESULT_OPTIONS('All', 'Pass', 'Fail')}
              value={localAlcohol}
              onChange={setLocalAlcohol}
            />

            {operatorEmails && (
              <>
                <Text style={styles.sectionLabel}>Filter by date</Text>
                <View style={styles.presetRow}>
                  {DATE_PRESETS.map((preset) => (
                    <Pressable
                      key={preset.label}
                      style={styles.presetChip}
                      onPress={() => setLocalDateRange(preset.range())}
                    >
                      <Text style={styles.presetChipText}>{preset.label}</Text>
                    </Pressable>
                  ))}
                  {localDateRange && (
                    <Pressable style={styles.presetChip} onPress={() => setLocalDateRange(null)}>
                      <Text style={styles.presetChipText}>Clear</Text>
                    </Pressable>
                  )}
                </View>
                <DateField
                  label="From"
                  value={localDateRange?.fromMillis ?? null}
                  onChange={(millis) => setLocalDateRange((r) => ({ fromMillis: startOfDay(millis), toMillis: r?.toMillis ?? null }))}
                />
                <DateField
                  label="To"
                  value={localDateRange?.toMillis ?? null}
                  onChange={(millis) => setLocalDateRange((r) => ({ fromMillis: r?.fromMillis ?? null, toMillis: endOfDay(millis) }))}
                />
              </>
            )}
          </ScrollView>
          <View style={styles.buttonRow}>
            <Button
              title="Reset"
              variant="text"
              onPress={() => {
                setLocalOperator(ALL_OPERATORS_LABEL);
                setLocalDateRange(null);
                onReset();
              }}
              style={styles.resetButton}
            />
            <View style={styles.rightButtons}>
              <Button title="Cancel" variant="text" onPress={onCancel} style={styles.rightButton} />
              <Button
                title="Apply"
                variant="text"
                onPress={() =>
                  onApply(
                    localSort,
                    localDrug,
                    localAlcohol,
                    operatorEmails
                      ? localOperator === ALL_OPERATORS_LABEL
                        ? null
                        : localOperator
                      : undefined,
                    operatorEmails ? localDateRange : undefined
                  )
                }
                style={styles.rightButton}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 20 },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: 20, maxHeight: '80%' },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginBottom: 12 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginTop: 12, marginBottom: 4 },
  buttonRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 },
  resetButton: { paddingHorizontal: 4 },
  rightButtons: { flexDirection: 'row' },
  rightButton: { paddingHorizontal: 4, marginLeft: 8 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.brandPrimary,
  },
  presetChipText: { fontSize: 12, fontWeight: '600', color: colors.brandPrimary },
});
