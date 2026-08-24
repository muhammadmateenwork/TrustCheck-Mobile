import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { MaterialIcons } from '@expo/vector-icons';
import { formatDate, formatDateTime } from '../utils/dateUtils';
import { colors } from '../theme';

interface Props {
  label: string;
  value: number | null;
  onChange: (millis: number) => void;
  maxDate?: Date;
  minDate?: Date;
  mode?: 'date' | 'datetime';
}

/** Shared date/date-time picker field, mirroring DateUtils.showDatePicker/showDateTimePicker's
 *  role in the native app. */
export default function DateField({ label, value, onChange, maxDate, minDate, mode = 'date' }: Props) {
  const [showPicker, setShowPicker] = useState(false);
  const [stage, setStage] = useState<'date' | 'time'>('date');
  const [pendingDate, setPendingDate] = useState<Date | null>(null);

  const open = () => {
    setStage('date');
    setShowPicker(true);
  };

  const onPicked = (event: { type: string }, selected?: Date) => {
    if (Platform.OS === 'android') setShowPicker(false);
    if (event.type === 'dismissed' || !selected) return;

    if (mode === 'date') {
      onChange(selected.getTime());
      return;
    }

    // datetime mode: date step, then a time step (no combined native picker on Android)
    if (stage === 'date') {
      setPendingDate(selected);
      setStage('time');
      if (Platform.OS === 'android') setShowPicker(true);
      return;
    }
    const base = pendingDate ?? selected;
    const combined = new Date(base);
    combined.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    onChange(combined.getTime());
    setPendingDate(null);
  };

  const displayValue = mode === 'datetime' ? formatDateTime(value) : formatDate(value);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <Pressable style={({ pressed }) => [styles.field, pressed && styles.fieldPressed]} onPress={open}>
        <Text style={value ? styles.value : styles.placeholder}>
          {displayValue || 'Tap to select'}
        </Text>
        <MaterialIcons name={mode === 'datetime' ? 'event' : 'calendar-today'} size={18} color={colors.textSecondary} />
      </Pressable>
      {showPicker && (
        <DateTimePicker
          value={pendingDate ?? (value ? new Date(value) : new Date())}
          mode={stage === 'time' ? 'time' : 'date'}
          maximumDate={maxDate}
          minimumDate={minDate}
          onChange={onPicked}
          is24Hour
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 16 },
  label: { fontSize: 13, color: colors.textSecondary, marginBottom: 6 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: colors.surface,
  },
  fieldPressed: { backgroundColor: colors.background },
  value: { fontSize: 15, color: colors.textPrimary },
  placeholder: { fontSize: 15, color: colors.textSecondary },
});
