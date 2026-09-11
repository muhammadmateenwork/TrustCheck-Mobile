import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { fetchCompanyWideTestSummary, DateRange, TestSummaryResult, SummaryResultFilter } from '../services/cloudSync';
import { buildSummaryWorkbookBase64, saveSummaryWorkbookToDownloads, shareSummaryWorkbook, formatDateRangeForDisplay } from '../services/countsExport';
import { REASON_FOR_TEST_OPTIONS } from '../models/TestSetup';
import SelectField from '../components/SelectField';
import DateField from '../components/DateField';
import RadioGroup, { RadioOption } from '../components/RadioGroup';
import Button from '../components/Button';
import { useToast } from '../components/Toast';
import { colors } from '../theme';

const ALL_REASONS_LABEL = 'All reasons';
const ALL_OPERATORS_LABEL = 'All operators';

const RESULT_FILTER_OPTIONS: RadioOption<SummaryResultFilter>[] = [
  { value: 'ALL', label: 'All' },
  { value: 'NEGATIVE', label: 'Negative' },
  { value: 'NON_NEGATIVE', label: 'Non-Negative' },
];

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
 * reversing it). Not scoped to the signed-in operator by default — an explicit product decision:
 * this is a company-wide total, not a personal one.
 *
 * Shared by both the operator's own "Test Analytics" menu item (HistoryScreen, no route params)
 * AND Admin's (AdminScreen, passes `operatorEmails` — every operator's email — as a route param).
 * That one param is the only difference: when present, an extra "Filter by operator" dropdown is
 * shown first (matching FilterModal's own field order) and its selection is sent to the Cloud
 * Function as a fifth filter; when absent, there's no way to narrow to one specific operator and
 * every query stays company-wide, exactly as before. This is deliberately the SAME page for both,
 * not two parallel screens, so a filter-combination bug only ever needs fixing once.
 *
 * Both the live count and the export are powered by fetchCompanyWideTestSummary, which calls the
 * getTestSummary Cloud Function rather than querying Firestore directly — firestore.rules only
 * let a non-admin operator read THEIR OWN testRecords documents, so a client-side query spanning
 * every operator would simply be rejected. The Cloud Function uses the Admin SDK server-side to
 * compute the counts and returns only the aggregate numbers, never the underlying documents — see
 * that function's own doc for why that's what keeps this safe, and for why ALL five filters
 * (operator, date range, reason, drug, alcohol) are ANDed together in that one place. Guest/
 * anonymous sessions are automatically excluded with no extra filtering needed, since they never
 * sync to Firestore at all — there's nothing to count.
 *
 * The reason filter is sent to the server as a real filter, not just a client-side lookup into
 * an always-full breakdown — it's multi-select (zero or more of REASON_FOR_TEST_OPTIONS, an
 * empty selection meaning "all reasons"), and narrows total/byDate to just the selected reasons.
 * The Reason -> Count table itself only lists the selected subset (or every reason when none are
 * selected), and is omitted entirely when exactly one reason is selected — a 1-row table that's
 * just the same number as the total again isn't informative (see TestSummaryResult's own doc).
 */
export default function MyTestCountsScreen({ route }: Props) {
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const operatorEmails = route.params?.operatorEmails;

  const [dateRange, setDateRange] = useState<DateRange | null>(null);
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);
  const [drugFilter, setDrugFilter] = useState<SummaryResultFilter>('ALL');
  const [alcoholFilter, setAlcoholFilter] = useState<SummaryResultFilter>('ALL');
  const [operatorEmail, setOperatorEmail] = useState<string>(ALL_OPERATORS_LABEL);
  const [summary, setSummary] = useState<TestSummaryResult | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [exporting, setExporting] = useState<'download' | 'share' | null>(null);

  const operatorForQuery = operatorEmail === ALL_OPERATORS_LABEL ? null : operatorEmail;
  const reasonsLabel = selectedReasons.length === 0 ? ALL_REASONS_LABEL : selectedReasons.join(', ');

  const toggleReason = (r: string) => {
    setSelectedReasons((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  };

  useEffect(() => {
    let cancelled = false;
    setLoadingSummary(true);
    fetchCompanyWideTestSummary(dateRange, selectedReasons, drugFilter, alcoholFilter, operatorForQuery)
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
  }, [dateRange, selectedReasons, drugFilter, alcoholFilter, operatorForQuery]);

  const count = summary?.total ?? null;

  const buildExport = async () => {
    // Fetched fresh rather than reusing `summary` — guarantees the export reflects the exact
    // filters on screen right now, not a possibly-stale cache from mid-transition.
    const freshSummary = await fetchCompanyWideTestSummary(dateRange, selectedReasons, drugFilter, alcoholFilter, operatorForQuery);
    const resultLabel = (f: SummaryResultFilter) => (f === 'ALL' ? 'All' : f === 'NEGATIVE' ? 'Negative' : 'Non-Negative');
    const filters = [
      ...(operatorEmails ? [{ label: 'Operator', value: operatorEmail }] : []),
      { label: 'Date range', value: formatDateRangeForDisplay(dateRange?.fromMillis, dateRange?.toMillis) },
      { label: 'Reason for test', value: reasonsLabel },
      { label: 'Drug test result', value: resultLabel(drugFilter) },
      { label: 'Alcohol test result', value: resultLabel(alcoholFilter) },
    ];
    return buildSummaryWorkbookBase64('TrustCheck Test Analytics', filters, freshSummary);
  };

  const onDownload = async () => {
    setExporting('download');
    try {
      const base64 = await buildExport();
      const result = await saveSummaryWorkbookToDownloads(base64, `TrustCheck_TestAnalytics_${Date.now()}.xlsx`);
      showToast(result === 'saved' ? 'Saved to Downloads' : 'Ready to share', 'success');
    } catch (e) {
      showToast(`Could not export: ${(e as Error).message}`, 'error');
    } finally {
      setExporting(null);
    }
  };

  const onShare = async () => {
    setExporting('share');
    try {
      const base64 = await buildExport();
      await shareSummaryWorkbook(base64, `TrustCheck_TestAnalytics_${Date.now()}.xlsx`);
    } catch (e) {
      showToast(`Could not share: ${(e as Error).message}`, 'error');
    } finally {
      setExporting(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={[styles.container, { paddingBottom: 24 + insets.bottom }]}>
      {operatorEmails && (
        <>
          <Text style={styles.sectionLabel}>Filter by operator</Text>
          <SelectField
            label=""
            value={operatorEmail}
            options={[ALL_OPERATORS_LABEL, ...operatorEmails]}
            onChange={setOperatorEmail}
          />
        </>
      )}

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
      <View style={styles.presetRow}>
        {REASON_FOR_TEST_OPTIONS.map((r) => {
          const selected = selectedReasons.includes(r);
          return (
            <Pressable
              key={r}
              style={[styles.presetChip, selected && styles.presetChipSelected]}
              onPress={() => toggleReason(r)}
            >
              <Text style={[styles.presetChipText, selected && styles.presetChipTextSelected]}>{r}</Text>
            </Pressable>
          );
        })}
        {selectedReasons.length > 0 && (
          <Pressable style={styles.presetChip} onPress={() => setSelectedReasons([])}>
            <Text style={styles.presetChipText}>Clear</Text>
          </Pressable>
        )}
      </View>

      <Text style={styles.sectionLabel}>Drug test result</Text>
      <RadioGroup options={RESULT_FILTER_OPTIONS} value={drugFilter} onChange={setDrugFilter} horizontal />

      <Text style={styles.sectionLabel}>Alcohol test result</Text>
      <RadioGroup options={RESULT_FILTER_OPTIONS} value={alcoholFilter} onChange={setAlcoholFilter} horizontal />

      <View style={styles.countCard}>
        {loadingSummary ? (
          <ActivityIndicator color={colors.brandPrimary} />
        ) : (
          <>
            <Text style={styles.countNumber}>{count ?? '—'}</Text>
            <Text style={styles.countLabel}>{selectedReasons.length === 0 ? 'tests (all reasons)' : `tests — ${reasonsLabel}`}</Text>
          </>
        )}
      </View>

      <View style={styles.exportRow}>
        <Button
          title={exporting === 'download' ? 'Exporting…' : 'Download'}
          icon="file-download"
          onPress={() => void onDownload()}
          loading={exporting === 'download'}
          disabled={exporting === 'share'}
          style={styles.exportButton}
        />
        <Button
          title={exporting === 'share' ? 'Sharing…' : 'Share'}
          icon="share"
          variant="outlined"
          onPress={() => void onShare()}
          loading={exporting === 'share'}
          disabled={exporting === 'download'}
          style={styles.exportButton}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: colors.background },
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
  presetChipSelected: { backgroundColor: colors.brandPrimary },
  presetChipTextSelected: { color: colors.white },
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
  exportRow: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  exportButton: { flex: 1 },
});
