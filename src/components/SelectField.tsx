import React, { useState } from 'react';
import { View, Text, Pressable, Modal, FlatList, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme';

interface Props {
  label: string;
  value: string | null;
  options: readonly string[];
  onChange: (value: string) => void;
}

/** Shared dropdown-style picker, matching the native app's AutoCompleteTextView-as-dropdown
 *  usage (e.g. Reason for Test, Measurement Unit). */
export default function SelectField({ label, value, options, onChange }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Pressable style={({ pressed }) => [styles.field, pressed && styles.fieldPressed]} onPress={() => setOpen(true)}>
        <Text style={value ? styles.value : styles.placeholder}>{value || 'Tap to select'}</Text>
        <MaterialIcons name="arrow-drop-down" size={22} color={colors.textSecondary} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.card}>
            <FlatList
              data={options}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.option}
                  onPress={() => {
                    onChange(item);
                    setOpen(false);
                  }}
                >
                  <Text style={styles.optionText}>{item}</Text>
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>
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
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 30 },
  card: { backgroundColor: colors.surface, borderRadius: 12, maxHeight: '60%' },
  option: { paddingVertical: 14, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: colors.divider },
  optionText: { fontSize: 15, color: colors.textPrimary },
});
