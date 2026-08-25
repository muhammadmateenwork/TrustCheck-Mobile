import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { TestRecord, donorFullName } from '../models/TestRecord';
import { formatDateTime } from '../utils/dateUtils';
import Badge from './Badge';
import { colors } from '../theme';

/** Mirrors item_test_record.xml + HistoryAdapter.java's binding logic. When `selectable` is set
 *  (Admin's bulk-download selection mode — see AdminScreen), tapping the row toggles selection
 *  instead of opening the record, and the avatar is replaced with a checkbox. */
export default function RecordListItem({
  record,
  onPress,
  selectable,
  selected,
  onToggleSelect,
}: {
  record: TestRecord;
  onPress: () => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const fullName = donorFullName(record);
  const initial = fullName.length > 0 && !fullName.startsWith('(') ? fullName[0].toUpperCase() : '?';
  const drugLabel = labelFor(record.drugResult.overallResult);
  const alcoholLabel = alcoholLabelFor(record.alcoholResult.firstTestResult);

  return (
    <Pressable style={styles.row} onPress={selectable ? onToggleSelect : onPress}>
      {selectable ? (
        <MaterialIcons
          name={selected ? 'check-circle' : 'radio-button-unchecked'}
          size={28}
          color={selected ? colors.brandAccent : colors.textSecondary}
          style={styles.checkbox}
        />
      ) : (
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
      )}
      <View style={styles.content}>
        <Text style={styles.name}>{fullName}</Text>
        <Text style={styles.meta}>
          ID: {record.donor.donorId || '-'}  •  {formatDateTime(record.createdAt)}
        </Text>
        <View style={styles.badges}>
          <Badge text={`Drug: ${drugLabel}`} result={record.drugResult.overallResult} />
          <Badge text={`Alcohol: ${alcoholLabel}`} result={record.alcoholResult.firstTestResult} />
        </View>
      </View>
      {!selectable && <MaterialIcons name="chevron-right" size={20} color={colors.textSecondary} />}
    </Pressable>
  );
}

function labelFor(result: string | null): string {
  if (result === 'NEGATIVE') return 'Negative';
  if (result === 'NON_NEGATIVE') return 'Non-Negative';
  return '-';
}

function alcoholLabelFor(result: string | null): string {
  if (result === 'NEGATIVE') return 'Pass';
  if (result === 'NON_NEGATIVE') return 'Fail';
  return '-';
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    padding: 14,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.divider,
    marginTop: 6,
    marginBottom: 6,
    elevation: 1,
    shadowColor: colors.black,
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    alignItems: 'center',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: { color: colors.white, fontSize: 18, fontWeight: '700' },
  checkbox: { marginRight: 12 },
  content: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  meta: { fontSize: 12, color: colors.textSecondary, marginTop: 2, marginBottom: 6 },
  badges: { flexDirection: 'row' },
});
