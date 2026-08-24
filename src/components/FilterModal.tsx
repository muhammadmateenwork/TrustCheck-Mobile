import React from 'react';
import { Modal, View, Text, StyleSheet, ScrollView } from 'react-native';
import RadioGroup, { RadioOption } from './RadioGroup';
import SelectField from './SelectField';
import Button from './Button';
import { Sort, ResultOption } from '../models/HistoryFilter';
import { ANONYMOUS_OPERATOR_FILTER } from '../services/cloudSync';
import { colors } from '../theme';

const ALL_OPERATORS_LABEL = 'All operators';
const ANONYMOUS_OPERATOR_LABEL = 'Anonymous (no login)';

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
  onCancel: () => void;
  onReset: () => void;
  onApply: (sort: Sort, drugFilter: ResultOption, alcoholFilter: ResultOption, operatorFilterEmail?: string | null) => void;
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
  onCancel,
  onReset,
  onApply,
}: Props) {
  const [localSort, setLocalSort] = React.useState(sort);
  const [localDrug, setLocalDrug] = React.useState(drugFilter);
  const [localAlcohol, setLocalAlcohol] = React.useState(alcoholFilter);
  const operatorFilterToLabel = (email: string | null | undefined) =>
    email === ANONYMOUS_OPERATOR_FILTER ? ANONYMOUS_OPERATOR_LABEL : email ?? ALL_OPERATORS_LABEL;

  const [localOperator, setLocalOperator] = React.useState(operatorFilterToLabel(operatorFilterEmail));

  React.useEffect(() => {
    if (visible) {
      setLocalSort(sort);
      setLocalDrug(drugFilter);
      setLocalAlcohol(alcoholFilter);
      setLocalOperator(operatorFilterToLabel(operatorFilterEmail));
    }
  }, [visible, sort, drugFilter, alcoholFilter, operatorFilterEmail]);

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
                  options={[ALL_OPERATORS_LABEL, ANONYMOUS_OPERATOR_LABEL, ...operatorEmails]}
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
          </ScrollView>
          <View style={styles.buttonRow}>
            <Button
              title="Reset"
              variant="text"
              onPress={() => {
                setLocalOperator(ALL_OPERATORS_LABEL);
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
                        : localOperator === ANONYMOUS_OPERATOR_LABEL
                          ? ANONYMOUS_OPERATOR_FILTER
                          : localOperator
                      : undefined
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
});
