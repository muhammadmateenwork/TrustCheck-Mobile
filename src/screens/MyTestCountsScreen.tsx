import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { fetchCompanyWideTestSummary, DateRange, ReasonCount } from '../services/cloudSync';
import { buildCountsCsv, saveCsvToDownloads } from '../services/countsExport';
import { REASON_FOR_TEST_OPTIONS } from '../models/TestSetup';
import SelectField from '../components/SelectField';
import DateField from '../components/DateField';
import Button from '../components/Button';
import { useToast } from '../components/Toast';
import { colors } from '../theme';

const ALL_REASONS_LABEL = 'All reasons';

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
];

type Props = NativeStackScreenProps<RootStackParamList, 'MyTestCounts'>;

/**
 * Counts-only view of TOTAL tests performed across every operator — deliberately never lets the
 * viewer open, browse, or view any individual record or PDF from here (that restriction predates
 * this screen, see HistoryScreen's own doc; this adds visibility into HOW MANY tests without
 * reversing it). Not scoped to the signed-in operator — an explicit product decision: this is a
 * company-wide total, not a personal one.
 *
 * Both the live count and the CSV export are powered by fetchCompanyWideTestSummary, which calls
 * the getTestSummary Cloud Function rather than querying Firestore directly — firestore.rules
 * only let a non-admin operator read THEIR OWN testRecords documents, so a client-side query
 * spanning every operator would simply be rejected. The Cloud Function uses the Admin SDK
 * server-side to compute the counts and returns only the aggregate numbers, never the underlying
 * documents — see that function's own doc for why that's what keeps this safe. Guest/anonymous
 * sessions are automatically excluded with no extra filtering needed, since they never sync to
 * Firestore at all — there's nothing to count.
 *
 * One fetch per date-range change returns the full per-reason breakdown; the reason dropdown just
 * picks which row of that already-fetched breakdown to show as the live number, so switching it
 * doesn't need another round trip. The CSV export always contains the full breakdown regardless
 * of that dropdown, since it's a strict superset and a more useful standalone report.
 */
export default function MyTestCountsScreen({}: Props) {
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();

  const [dateRange, setDateRange] = useState<DateRange | null>(null);
  const [reason, setReason] = useState<string>(ALL_REASONS_LABEL);
  const [summary, setSummary] = useState<{ byReason: ReasonCount[]; total: number } | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingSummary(true);
    fetchCompanyWideTestSummary(dateRange)
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .catch((e) => {
        console.log('[MyTestCounts] fetchCompanyWideTestSummary failed:', e);
        if (!cancelled) setSummary(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingSummary(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dateRange]);

  const count =
    summary == null ? null : reason === ALL_REASONS_LABEL ? summary.total : summary.byReason.find((r) => r.reason === reason)?.count ?? 0;

  const onExportCsv = async () => {
    setExporting(true);
    try {
      // Fetched fresh rather than reusing `summary` — guarantees the export reflects the exact
      // date range on screen right now, not a possibly-stale cache from mid-transition.
      const { byReason, total } = await fetchCompanyWideTestSummary(dateRange);
      const csv = buildCountsCsv(
        [
          { label: 'Scope', value: 'All operators (guest/anonymous tests excluded)' },
          { label: 'From', value: dateRange?.fromMillis ? new Date(dateRange.fromMillis).toLocaleDateString() : 'Any' },
          { label: 'To', value: dateRange?.toMillis ? new Date(dateRange.toMillis).toLocaleDateString() : 'Any' },
        ],
        byReason,
        total
      );
      const result = await saveCsvToDownloads(csv, `TrustCheck_TestSummary_${Date.now()}.csv`);
      showToast(result === 'saved' ? 'Saved to Downloads' : 'Ready to share', 'success');
    } catch (e) {
      showToast(`Could not export: ${(e as Error).message}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={[styles.container, { paddingBottom: 24 + insets.bottom }]}>
      <Text style={styles.instruction}>
        See how many tests have been performed across all operators, filtered by date range and/or
        reason — guest/anonymous tests aren&apos;t included, and individual records and PDFs
        aren&apos;t viewable here.
      </Text>

      <Text style={styles.sectionLabel}>Filter by date</Text>
      <View style={styles.presetRow}>
        {DATE_PRESETS.map((preset) => (
          <Pressable key={preset.label} style={styles.presetChip} onPress={() => setDateRange(preset.range())}>
            <Text style={styles.presetChipText}>{preset.label}</Text>
          </Pressable>
        ))}
        {dateRange && (
          <Pressable style={styles.presetChip} onPress={() => setDateRange(null)}>
            <Text style={styles.presetChipText}>Clear</Text>
          </Pressable>
        )}
      </View>
      <DateField
        label="From"
        value={dateRange?.fromMillis ?? null}
        onChange={(millis) => setDateRange((r) => ({ fromMillis: startOfDay(millis), toMillis: r?.toMillis ?? null }))}
      />
      <DateField
        label="To"
        value={dateRange?.toMillis ?? null}
        onChange={(millis) => setDateRange((r) => ({ fromMillis: r?.fromMillis ?? null, toMillis: endOfDay(millis) }))}
      />

      <Text style={styles.sectionLabel}>Filter by reason for test</Text>
      <SelectField label="" value={reason} options={[ALL_REASONS_LABEL, ...REASON_FOR_TEST_OPTIONS]} onChange={setReason} />

      <View style={styles.countCard}>
        {loadingSummary ? (
          <ActivityIndicator color={colors.brandPrimary} />
        ) : (
          <>
            <Text style={styles.countNumber}>{count ?? '—'}</Text>
            <Text style={styles.countLabel}>{reason === ALL_REASONS_LABEL ? 'tests (all reasons)' : `tests — ${reason}`}</Text>
          </>
        )}
      </View>

      <Button
        title={exporting ? 'Exporting…' : 'Download as CSV'}
        icon="file-download"
        onPress={() => void onExportCsv()}
        loading={exporting}
        style={styles.exportButton}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: colors.background },
  instruction: { fontSize: 13, color: colors.textSecondary, marginBottom: 20, lineHeight: 18 },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginTop: 8, marginBottom: 8 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.brandPrimary,
  },
  presetChipText: { fontSize: 12, fontWeight: '600', color: colors.brandPrimary },
  countCard: {
    marginTop: 24,
    marginBottom: 24,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingVertical: 28,
    alignItems: 'center',
  },
  countNumber: { fontSize: 40, fontWeight: '700', color: colors.brandPrimary },
  countLabel: { fontSize: 13, color: colors.textSecondary, marginTop: 4 },
  exportButton: { marginBottom: 8 },
});
