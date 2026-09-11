import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  Pressable,
  Modal,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { signOut } from 'firebase/auth';
import { MaterialIcons } from '@expo/vector-icons';
import { RootStackParamList } from '../navigation/types';
import { resetTo } from '../navigation/resetTo';
import { firebaseAuth } from '../services/firebase';
import { ensureAnonymousSession } from '../services/authSession';
import {
  listAllOperatorEmails,
  listOperatorsPage,
  createOperator,
  deactivateOperator,
  reactivateOperator,
  deleteOperator,
} from '../services/adminRepository';
import {
  fetchAllRecordsPage,
  watchNewestRecordId,
  loadRecordForAdmin,
  DateRange,
} from '../services/cloudSync';
import { getOrGeneratePdf } from '../services/pdfReportGenerator';
import { saveRecord } from '../services/recordRepository';
import { enqueueDownload, useDownloadJobs } from '../services/downloadQueue';
import DownloadsPanel from '../components/DownloadsPanel';
import { Operator } from '../models/Operator';
import { TestRecord, donorFullName } from '../models/TestRecord';
import { HistoryFilter, createHistoryFilter, applyHistoryFilter, isDefaultFilter } from '../models/HistoryFilter';
import RecordListItem from '../components/RecordListItem';
import TextField from '../components/TextField';
import FilterModal from '../components/FilterModal';
import RadioGroup from '../components/RadioGroup';
import Button from '../components/Button';
import ChangePasswordModal from '../components/ChangePasswordModal';
import KeyboardAvoidingScreen from '../components/KeyboardAvoidingScreen';
import { useToast } from '../components/Toast';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Admin'>;

const RECORDS_PAGE_SIZE = 20;
const OPERATORS_PAGE_SIZE = 20;

type OperatorStatusFilter = 'all' | 'active' | 'inactive';

function applyOperatorFilter(operators: Operator[], searchQuery: string, statusFilter: OperatorStatusFilter): Operator[] {
  const q = searchQuery.trim().toLowerCase();
  return operators.filter((op) => {
    if (q && !op.email.toLowerCase().includes(q)) return false;
    if (statusFilter === 'active' && !op.active) return false;
    if (statusFilter === 'inactive' && op.active) return false;
    return true;
  });
}

/**
 * Mirrors AdminFragment.java — two tabs (Operators, Records), strictly view-only for records (see
 * firestore.rules: create-only, no admin edit/delete affordance). Records combines a server-side
 * operator filter with client-side search/sort/result filters, same split as HistoryFragment (see
 * HistoryFilter's own doc).
 */
export default function AdminScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const [tab, setTab] = useState<'operators' | 'records'>('operators');
  const [menuVisible, setMenuVisible] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [changePasswordVisible, setChangePasswordVisible] = useState(false);

  // ---- Operators ----
  // The Records tab's "Filter by operator" dropdown needs every operator's email regardless of
  // how far the paginated list below has been scrolled — see listAllOperatorEmails's own doc for
  // why that's a separate, deliberately unbounded fetch from the paginated tab list itself.
  const [allOperatorEmails, setAllOperatorEmails] = useState<Operator[]>([]);
  const [loadedOperators, setLoadedOperators] = useState<Operator[]>([]);
  const [operatorSearchQuery, setOperatorSearchQuery] = useState('');
  const [operatorStatusFilter, setOperatorStatusFilter] = useState<OperatorStatusFilter>('all');
  const [operatorFilterVisible, setOperatorFilterVisible] = useState(false);
  const [loadingOperators, setLoadingOperators] = useState(true);
  const [refreshingOperators, setRefreshingOperators] = useState(false);
  const [hasMoreOperators, setHasMoreOperators] = useState(true);
  const [addOperatorVisible, setAddOperatorVisible] = useState(false);

  const operatorsCursor = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const isLoadingOperatorsRef = useRef(false);
  const hasMoreOperatorsRef = useRef(true);

  const loadAllOperatorEmails = useCallback(async () => {
    try {
      setAllOperatorEmails(await listAllOperatorEmails());
    } catch (e) {
      showToast(`Could not load operator list: ${(e as Error).message}`, 'error');
    }
  }, []);

  // Same shape as loadRecordsPage below, same reasoning for reading hasMoreOperatorsRef instead
  // of a hasMoreOperators dependency — see that function's own comment.
  const loadOperatorsPage = useCallback(async (isFirstPage: boolean) => {
    if (isLoadingOperatorsRef.current || !hasMoreOperatorsRef.current) return;
    isLoadingOperatorsRef.current = true;
    setLoadingOperators(true);
    try {
      const page = await listOperatorsPage(isFirstPage ? null : operatorsCursor.current, OPERATORS_PAGE_SIZE);
      operatorsCursor.current = page.cursor;
      hasMoreOperatorsRef.current = page.hasMore;
      setHasMoreOperators(page.hasMore);
      setLoadedOperators((prev) => (isFirstPage ? page.operators : [...prev, ...page.operators]));
    } catch (e) {
      showToast(`Could not load operators: ${(e as Error).message}`, 'error');
    } finally {
      isLoadingOperatorsRef.current = false;
      setLoadingOperators(false);
    }
  }, []);

  const resetAndLoadOperators = useCallback(() => {
    operatorsCursor.current = null;
    hasMoreOperatorsRef.current = true;
    setHasMoreOperators(true);
    setLoadedOperators([]);
    isLoadingOperatorsRef.current = false;
  }, []);

  const onRefreshOperators = useCallback(async () => {
    setRefreshingOperators(true);
    resetAndLoadOperators();
    await Promise.all([loadOperatorsPage(true), loadAllOperatorEmails()]);
    setRefreshingOperators(false);
  }, [resetAndLoadOperators, loadOperatorsPage, loadAllOperatorEmails]);

  // Used after create/deactivate/reactivate/delete — the action just changed something the
  // paginated list AND the dropdown's full email list both need to reflect, so both refetch from
  // scratch rather than trying to patch one operator into whichever page it happened to be on.
  const refreshOperatorsAfterChange = useCallback(() => {
    resetAndLoadOperators();
    void loadOperatorsPage(true);
    void loadAllOperatorEmails();
  }, [resetAndLoadOperators, loadOperatorsPage, loadAllOperatorEmails]);

  const visibleOperators = applyOperatorFilter(loadedOperators, operatorSearchQuery, operatorStatusFilter);

  // ---- Records ----
  const [loadedRecords, setLoadedRecords] = useState<TestRecord[]>([]);
  const [mediaUrlsByRecordId, setMediaUrlsByRecordId] = useState<Record<string, Record<string, string>>>({});
  const [recordFilter, setRecordFilter] = useState<HistoryFilter>(createHistoryFilter());
  const [operatorFilterEmail, setOperatorFilterEmail] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | null>(null);
  const [reasonFilter, setReasonFilter] = useState<string | null>(null);
  const [filterVisible, setFilterVisible] = useState(false);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [refreshingRecords, setRefreshingRecords] = useState(false);
  const [hasMoreRecords, setHasMoreRecords] = useState(true);
  const [openingRecord, setOpeningRecord] = useState(false);
  const [openProgress, setOpenProgress] = useState(0);

  // ---- Bulk report download (select mode) ----
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [downloadsVisible, setDownloadsVisible] = useState(false);
  const downloadJobs = useDownloadJobs();
  const activeDownloadCount = downloadJobs.filter(
    (j) => j.status === 'queued' || j.status === 'running' || j.status === 'paused'
  ).length;

  const recordsCursor = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const isLoadingRecordsRef = useRef(false);
  const newestRecordUnsub = useRef<(() => void) | null>(null);
  const openCancelledRef = useRef(false);
  // Read at call time instead of via useCallback's dependency array — loadRecordsPage is called
  // synchronously right after resetAndLoadRecords() (e.g. on refresh, or switching the operator
  // filter), before setHasMoreRecords(true)'s state update has flushed to a new render. A
  // dependency-array-based hasMoreRecords would still be closing over whatever it was at the END
  // of the PREVIOUS filter's pagination — false, if that filter had been scrolled to its end —
  // and the guard below would wrongly refuse to load the new filter's first page at all.
  const hasMoreRecordsRef = useRef(true);
  const loadedRecordsRef = useRef<TestRecord[]>([]);

  const loadRecordsPage = useCallback(
    async (isFirstPage: boolean) => {
      if (isLoadingRecordsRef.current || !hasMoreRecordsRef.current) return;
      isLoadingRecordsRef.current = true;
      setLoadingRecords(true);
      try {
        const page = await fetchAllRecordsPage(
          isFirstPage ? null : recordsCursor.current,
          operatorFilterEmail,
          RECORDS_PAGE_SIZE,
          dateRange,
          reasonFilter
        );
        recordsCursor.current = page.cursor;
        hasMoreRecordsRef.current = page.hasMore;
        setHasMoreRecords(page.hasMore);
        setLoadedRecords((prev) => {
          const next = isFirstPage ? page.records : [...prev, ...page.records];
          loadedRecordsRef.current = next;
          return next;
        });
        setMediaUrlsByRecordId((prev) => ({ ...prev, ...page.mediaUrlsByRecordId }));
      } catch (e) {
        showToast(`Could not load records: ${(e as Error).message}`, 'error');
      } finally {
        isLoadingRecordsRef.current = false;
        setLoadingRecords(false);
      }
    },
    [operatorFilterEmail, dateRange, reasonFilter]
  );

  const resetAndLoadRecords = useCallback(() => {
    recordsCursor.current = null;
    hasMoreRecordsRef.current = true;
    setHasMoreRecords(true);
    loadedRecordsRef.current = [];
    setLoadedRecords([]);
    setMediaUrlsByRecordId({});
    isLoadingRecordsRef.current = false;

    if (newestRecordUnsub.current) newestRecordUnsub.current();
    newestRecordUnsub.current = watchNewestRecordId(operatorFilterEmail, (newestId) => {
      if (isLoadingRecordsRef.current) return;
      const currentTopId = loadedRecordsRef.current.length > 0 ? loadedRecordsRef.current[0].id : null;
      if (newestId != null && newestId !== currentTopId) {
        void loadRecordsPage(true);
      }
    });
  }, [operatorFilterEmail, loadRecordsPage]);

  // Manual refresh — pull-to-refresh and the header's refresh button both call this to force a
  // fresh read from Firestore rather than waiting on the realtime listener (which only notices a
  // NEW newest record, not e.g. a record that finished syncing late after a flaky connection).
  const onRefreshRecords = useCallback(async () => {
    setRefreshingRecords(true);
    resetAndLoadRecords();
    await loadRecordsPage(true);
    setRefreshingRecords(false);
  }, [resetAndLoadRecords, loadRecordsPage]);

  // Runs once on mount: loads the first page of operators plus the full email list the records
  // filter dropdown needs, and cleans up the realtime listener on unmount.
  useEffect(() => {
    resetAndLoadOperators();
    void loadOperatorsPage(true);
    void loadAllOperatorEmails();
    return () => {
      if (newestRecordUnsub.current) newestRecordUnsub.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Single source of truth for (re)loading the records list — fires on mount AND whenever the
  // operator filter changes. Previously this same reset-and-load logic also lived in the
  // mount-only effect above, and BOTH effects fire on the initial mount (a dependency array only
  // skips re-runs on later renders, not the first one) — that meant resetAndLoadRecords() ran
  // twice back to back, the second call reset isLoadingRecordsRef mid-flight through the first
  // call's still-pending fetchAllRecordsPage(), and both calls' results could land and overwrite
  // each other. Consolidating into one effect removes that race entirely.
  useEffect(() => {
    resetAndLoadRecords();
    void loadRecordsPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operatorFilterEmail, dateRange, reasonFilter]);

  const visibleRecords = applyHistoryFilter(recordFilter, loadedRecords);

  const openRecord = async (summary: TestRecord) => {
    console.log('[Admin] openRecord: tapped', summary.id);
    setOpeningRecord(true);
    setOpenProgress(0);
    openCancelledRef.current = false;
    try {
      console.log('[Admin] openRecord: loading full record…');
      const fullRecord = await loadRecordForAdmin(summary, mediaUrlsByRecordId[summary.id] ?? null, (percent) => {
        if (!openCancelledRef.current) setOpenProgress(percent);
      });
      console.log('[Admin] openRecord: full record loaded, cancelled =', openCancelledRef.current);
      if (openCancelledRef.current) return;
      console.log('[Admin] openRecord: generating PDF…');
      const pdfPath = await getOrGeneratePdf(fullRecord);
      console.log('[Admin] openRecord: pdf ready at', pdfPath);
      await saveRecord(fullRecord);
      if (openCancelledRef.current) {
        console.log('[Admin] openRecord: cancelled after pdf ready, not navigating');
        return;
      }
      setOpeningRecord(false);
      console.log('[Admin] openRecord: navigating to PdfViewer');
      navigation.navigate('PdfViewer', { pdfPath, title: donorFullName(fullRecord) });
    } catch (e) {
      console.log('[Admin] openRecord: threw', e, 'cancelled =', openCancelledRef.current);
      if (!openCancelledRef.current) {
        setOpeningRecord(false);
        showToast(`Could not load record: ${(e as Error).message}`, 'error');
      }
    }
  };

  const cancelOpenRecord = () => {
    openCancelledRef.current = true;
    setOpeningRecord(false);
  };

  const toggleSelectionMode = () => {
    setSelectionMode((v) => !v);
    setSelectedIds(new Set());
  };

  const toggleSelectRecord = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Only the records actually loaded/visible under the current filters can be selected — bulk
  // download works off exactly what's on screen, same records the operator/date/result filters
  // already narrowed down, not some hidden "everything on the server" superset.
  const selectAllVisible = () => {
    setSelectedIds(new Set(visibleRecords.map((r) => r.id)));
  };

  // Enqueues and returns immediately — the job runs via downloadQueue.ts (queued, one at a time,
  // backed by a real background service), so this never blocks the UI. Progress/pause/cancel/share
  // all live in the Downloads panel from here on, not this screen.
  const downloadSelected = () => {
    const selected = visibleRecords.filter((r) => selectedIds.has(r.id));
    if (selected.length === 0) return;
    enqueueDownload(selected, mediaUrlsByRecordId);
    setSelectionMode(false);
    setSelectedIds(new Set());
    setDownloadsVisible(true);
    showToast(`Added to downloads — ${selected.length === 1 ? '1 report' : `${selected.length} reports`} queued`, 'success');
  };

  const confirmSignOut = () => {
    setMenuVisible(false);
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          // Both calls are real network round trips (Firebase Auth sign-out + a fresh anonymous
          // sign-in) — without this, the app just looked frozen for however long that took.
          setSigningOut(true);
          try {
            await signOut(firebaseAuth);
            await ensureAnonymousSession();
            resetTo(navigation, 'Setup', { justSignedOut: true });
          } finally {
            setSigningOut(false);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.title}>Admin</Text>
        <View style={styles.topBarActions}>
          <Pressable onPress={() => setDownloadsVisible(true)} style={styles.menuButton} hitSlop={4}>
            <MaterialIcons name="file-download" size={24} color={colors.white} />
            {activeDownloadCount > 0 && (
              <View style={styles.downloadBadge}>
                <Text style={styles.downloadBadgeText}>{activeDownloadCount}</Text>
              </View>
            )}
          </Pressable>
          <Pressable onPress={() => setMenuVisible(true)} style={styles.menuButton}>
            <MaterialIcons name="more-vert" size={24} color={colors.white} />
          </Pressable>
        </View>
      </View>

      <View style={styles.tabBar}>
        <Pressable style={[styles.tab, tab === 'operators' && styles.tabActive]} onPress={() => setTab('operators')}>
          <Text style={[styles.tabText, tab === 'operators' && styles.tabTextActive]}>Operators</Text>
        </Pressable>
        <Pressable style={[styles.tab, tab === 'records' && styles.tabActive]} onPress={() => setTab('records')}>
          <Text style={[styles.tabText, tab === 'records' && styles.tabTextActive]}>Records</Text>
        </Pressable>
      </View>

      {tab === 'operators' ? (
        <View style={styles.tabContent}>
          <View style={styles.searchRow}>
            <View style={styles.searchPill}>
              <MaterialIcons name="search" size={20} color={colors.textSecondary} />
              <TextInput
                placeholder="Search by email..."
                placeholderTextColor={colors.textSecondary}
                value={operatorSearchQuery}
                onChangeText={setOperatorSearchQuery}
                autoCapitalize="none"
                style={styles.searchInput}
              />
            </View>
            <Pressable onPress={() => setOperatorFilterVisible(true)} style={styles.iconButton} hitSlop={8}>
              <MaterialIcons name="filter-list" size={22} color={colors.brandPrimary} />
            </Pressable>
          </View>
          {operatorStatusFilter !== 'all' && (
            <Text style={styles.activeFilters}>Filters active — tap the icon to change</Text>
          )}

          <FlatList
            data={visibleOperators}
            keyExtractor={(item) => item.uid}
            renderItem={({ item }) => (
              <OperatorRow
                operator={item}
                onToggleActive={() => confirmToggleActive(item, refreshOperatorsAfterChange)}
                onDelete={() => confirmDelete(item, refreshOperatorsAfterChange)}
              />
            )}
            contentContainerStyle={[styles.list, { paddingBottom: 88 + insets.bottom }]}
            onEndReached={() => void loadOperatorsPage(false)}
            onEndReachedThreshold={0.3}
            refreshControl={
              <RefreshControl refreshing={refreshingOperators} onRefresh={() => void onRefreshOperators()} colors={[colors.brandPrimary]} />
            }
            ListEmptyComponent={
              !loadingOperators ? (
                <Text style={styles.emptyText}>
                  {loadedOperators.length > 0 ? 'No operators match your filters' : 'No operators yet'}
                </Text>
              ) : null
            }
            ListFooterComponent={loadingOperators ? <ActivityIndicator color={colors.brandPrimary} style={styles.loadingIndicator} /> : null}
          />

          <Button
            title="Add Operator"
            icon="add"
            onPress={() => setAddOperatorVisible(true)}
            style={[styles.addOperatorFab, { bottom: 16 + insets.bottom }]}
          />
        </View>
      ) : (
        <View style={styles.tabContent}>
          <View style={styles.searchRow}>
            <View style={styles.searchPill}>
              <MaterialIcons name="search" size={20} color={colors.textSecondary} />
              <TextInput
                placeholder="Search by name, ID, company..."
                placeholderTextColor={colors.textSecondary}
                value={recordFilter.searchQuery}
                onChangeText={(text) => setRecordFilter((f) => ({ ...f, searchQuery: text }))}
                style={styles.searchInput}
              />
            </View>
            <Pressable onPress={() => setFilterVisible(true)} style={styles.iconButton} hitSlop={8}>
              <MaterialIcons name="filter-list" size={22} color={colors.brandPrimary} />
            </Pressable>
            <Pressable onPress={toggleSelectionMode} style={styles.iconButton} hitSlop={8}>
              <MaterialIcons
                name={selectionMode ? 'close' : 'playlist-add-check'}
                size={22}
                color={colors.brandPrimary}
              />
            </Pressable>
          </View>
          {(!isDefaultFilter(recordFilter) || operatorFilterEmail || dateRange || reasonFilter) && (
            <Text style={styles.activeFilters}>Filters active — tap the icon to change</Text>
          )}
          {selectionMode && (
            <View style={styles.selectionBar}>
              <Text style={styles.selectionCount}>{selectedIds.size} selected</Text>
              <Pressable onPress={selectAllVisible} hitSlop={8}>
                <Text style={styles.selectionAction}>Select all</Text>
              </Pressable>
            </View>
          )}

          <FlatList
            data={visibleRecords}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <RecordListItem
                record={item}
                onPress={() => void openRecord(item)}
                selectable={selectionMode}
                selected={selectedIds.has(item.id)}
                onToggleSelect={() => toggleSelectRecord(item.id)}
              />
            )}
            contentContainerStyle={[styles.list, selectionMode && { paddingBottom: 88 + insets.bottom }]}
            onEndReached={() => void loadRecordsPage(false)}
            onEndReachedThreshold={0.3}
            refreshControl={
              <RefreshControl refreshing={refreshingRecords} onRefresh={() => void onRefreshRecords()} colors={[colors.brandPrimary]} />
            }
            ListEmptyComponent={
              !loadingRecords ? (
                <Text style={styles.emptyText}>
                  {loadedRecords.length > 0
                    ? 'No records match your filters'
                    : 'No test records yet. Records appear here once an operator completes a test.'}
                </Text>
              ) : null
            }
            ListFooterComponent={loadingRecords ? <ActivityIndicator color={colors.brandPrimary} style={styles.loadingIndicator} /> : null}
          />

          {selectionMode && selectedIds.size > 0 && (
            <Pressable
              onPress={downloadSelected}
              style={[styles.downloadFab, { bottom: 16 + insets.bottom }]}
              hitSlop={4}
            >
              <MaterialIcons name="file-download" size={26} color={colors.white} />
              <View style={styles.downloadFabBadge}>
                <Text style={styles.downloadFabBadgeText}>{selectedIds.size}</Text>
              </View>
            </Pressable>
          )}
        </View>
      )}

      <AddOperatorModal
        visible={addOperatorVisible}
        onClose={() => setAddOperatorVisible(false)}
        onCreated={refreshOperatorsAfterChange}
      />

      <FilterModal
        visible={filterVisible}
        sort={recordFilter.sort}
        drugFilter={recordFilter.drugFilter}
        alcoholFilter={recordFilter.alcoholFilter}
        operatorEmails={allOperatorEmails.map((op) => op.email)}
        operatorFilterEmail={operatorFilterEmail}
        dateRange={dateRange}
        reasonFilter={reasonFilter}
        onCancel={() => setFilterVisible(false)}
        onReset={() => {
          setRecordFilter(createHistoryFilter());
          setOperatorFilterEmail(null);
          setDateRange(null);
          setReasonFilter(null);
          setFilterVisible(false);
        }}
        onApply={(sort, drugFilter, alcoholFilter, operatorEmail, newDateRange, newReasonFilter) => {
          setRecordFilter((f) => ({ ...f, sort, drugFilter, alcoholFilter }));
          setOperatorFilterEmail(operatorEmail ?? null);
          setDateRange(newDateRange ?? null);
          setReasonFilter(newReasonFilter ?? null);
          setFilterVisible(false);
        }}
      />

      <OperatorFilterModal
        visible={operatorFilterVisible}
        statusFilter={operatorStatusFilter}
        onCancel={() => setOperatorFilterVisible(false)}
        onReset={() => {
          setOperatorStatusFilter('all');
          setOperatorFilterVisible(false);
        }}
        onApply={(statusFilter) => {
          setOperatorStatusFilter(statusFilter);
          setOperatorFilterVisible(false);
        }}
      />

      <ChangePasswordModal visible={changePasswordVisible} onClose={() => setChangePasswordVisible(false)} />

      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuVisible(false)}>
          <View style={styles.menuCard}>
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                navigation.navigate('MyTestCounts', { operatorEmails: allOperatorEmails.map((op) => op.email) });
              }}
            >
              <Text style={styles.menuItemText}>Test Analytics</Text>
            </Pressable>
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                setChangePasswordVisible(true);
              }}
            >
              <Text style={styles.menuItemText}>Change Password</Text>
            </Pressable>
            <Pressable style={styles.menuItem} onPress={confirmSignOut}>
              <Text style={styles.menuItemText}>Sign Out</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={openingRecord} transparent animationType="fade" onRequestClose={cancelOpenRecord}>
        <View style={styles.progressBackdrop}>
          <View style={styles.progressCard}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressTitle}>Opening Record</Text>
              <Pressable onPress={cancelOpenRecord} style={styles.progressCancel}>
                <MaterialIcons name="close" size={20} color={colors.textSecondary} />
              </Pressable>
            </View>
            <Text style={styles.progressMessage}>Loading record…</Text>
            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, { width: `${openProgress}%` }]} />
            </View>
            <Text style={styles.progressPercent}>{openProgress}%</Text>
          </View>
        </View>
      </Modal>

      <DownloadsPanel visible={downloadsVisible} onClose={() => setDownloadsVisible(false)} />

      <Modal visible={signingOut} transparent animationType="fade">
        <View style={styles.progressBackdrop}>
          <View style={styles.signingOutCard}>
            <ActivityIndicator color={colors.brandPrimary} />
            <Text style={styles.signingOutText}>Signing out…</Text>
          </View>
        </View>
      </Modal>
    </View>
  );

  function confirmToggleActive(operator: Operator, onDone: () => void) {
    const deactivating = operator.active;
    Alert.alert(
      deactivating ? 'Deactivate' : 'Reactivate',
      deactivating
        ? `Deactivate ${operator.email}? They will be signed out on all devices immediately and unable to log in until reactivated.`
        : `Reactivate ${operator.email}? They will be able to log in again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'OK',
          onPress: async () => {
            try {
              if (deactivating) await deactivateOperator(operator.uid);
              else await reactivateOperator(operator.uid);
              onDone();
            } catch (e) {
              showToast(`Could not update operator: ${(e as Error).message}`, 'error');
            }
          },
        },
      ]
    );
  }

  function confirmDelete(operator: Operator, onDone: () => void) {
    Alert.alert('Delete', `Permanently delete ${operator.email}? This cannot be undone. Their past test records are kept.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteOperator(operator.uid);
            onDone();
          } catch (e) {
            showToast(`Could not delete operator: ${(e as Error).message}`, 'error');
          }
        },
      },
    ]);
  }
}

function OperatorRow({
  operator,
  onToggleActive,
  onDelete,
}: {
  operator: Operator;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={styles.operatorRow}>
      <View style={styles.operatorInfoRow}>
        <Text style={styles.operatorEmail} numberOfLines={1}>
          {operator.email}
        </Text>
        <View style={[styles.statusBadge, operator.active ? styles.statusBadgeActive : styles.statusBadgeInactive]}>
          <Text style={[styles.statusBadgeText, operator.active ? styles.statusActive : styles.statusInactive]}>
            {operator.active ? 'Active' : 'Inactive'}
          </Text>
        </View>
      </View>
      <View style={styles.operatorActions}>
        <Button
          title={operator.active ? 'Deactivate' : 'Reactivate'}
          variant="outlined"
          onPress={onToggleActive}
          style={styles.operatorActionButton}
        />
        <Button title="Delete" variant="danger" onPress={onDelete} style={styles.operatorActionButton} />
      </View>
    </View>
  );
}

const OPERATOR_STATUS_OPTIONS: { value: OperatorStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

/** Operators only have the one filterable dimension beyond search text (active/inactive), so this
 *  is a lighter-weight sibling to FilterModal rather than reusing it outright — a single
 *  RadioGroup in the same backdrop/card visual language. */
function OperatorFilterModal({
  visible,
  statusFilter,
  onCancel,
  onReset,
  onApply,
}: {
  visible: boolean;
  statusFilter: OperatorStatusFilter;
  onCancel: () => void;
  onReset: () => void;
  onApply: (statusFilter: OperatorStatusFilter) => void;
}) {
  const [localStatus, setLocalStatus] = useState(statusFilter);

  useEffect(() => {
    if (visible) setLocalStatus(statusFilter);
  }, [visible, statusFilter]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.progressBackdrop}>
        <View style={styles.progressCard}>
          <Text style={styles.progressTitle}>Filter operators</Text>
          <Text style={styles.operatorFilterLabel}>Status</Text>
          <RadioGroup options={OPERATOR_STATUS_OPTIONS} value={localStatus} onChange={setLocalStatus} />
          <View style={styles.buttonRow}>
            <Button title="Reset" variant="text" onPress={onReset} style={styles.flexButton} />
            <Button title="Apply" onPress={() => onApply(localStatus)} style={styles.flexButton} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function AddOperatorModal({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { showToast } = useToast();

  const submit = async () => {
    if (!email.toLowerCase().endsWith('@ghella.com')) {
      showToast('Operator accounts must use a @ghella.com email address', 'error');
      return;
    }
    if (password.length < 6) {
      showToast('Password must be at least 6 characters', 'error');
      return;
    }
    setLoading(true);
    try {
      await createOperator(email.trim(), password);
      setLoading(false);
      setEmail('');
      setPassword('');
      setShowPassword(false);
      onClose();
      onCreated();
      showToast(`Operator account created — credentials emailed to ${email.trim()}`, 'success');
    } catch (e) {
      setLoading(false);
      showToast(`Could not create operator: ${(e as Error).message}`, 'error');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingScreen style={styles.addOperatorBackdrop} contentContainerStyle={styles.addOperatorScrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.progressCard}>
          <Text style={styles.progressTitle}>Add Operator</Text>
          <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" startIcon="email" />
          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            startIcon="lock"
            endIcon={showPassword ? 'visibility-off' : 'visibility'}
            onEndIconPress={() => setShowPassword((v) => !v)}
          />
          <Button title="Add Operator" onPress={submit} loading={loading} style={styles.addOperatorSubmit} />
          <Button title="Cancel" variant="text" onPress={onClose} style={styles.addOperatorCancel} />
        </View>
      </KeyboardAvoidingScreen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 14,
  },
  title: { fontSize: 20, fontWeight: '700', color: colors.white },
  topBarActions: { flexDirection: 'row', alignItems: 'center' },
  menuButton: { padding: 8 },
  downloadBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.brandAccent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  downloadBadgeText: { color: colors.white, fontSize: 10, fontWeight: '700' },
  tabBar: { flexDirection: 'row', backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: colors.brandAccent },
  tabText: { fontSize: 14, color: colors.textSecondary, fontWeight: '600' },
  tabTextActive: { color: colors.brandPrimary },
  tabContent: { flex: 1, padding: 16 },
  addOperatorFab: { position: 'absolute', left: 16, right: 16 },
  loadingIndicator: { marginTop: 24 },
  emptyText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginTop: 24 },
  operatorRow: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    padding: 12,
    elevation: 1,
    shadowColor: colors.black,
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    marginBottom: 8,
  },
  operatorInfoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  operatorEmail: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginRight: 8 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6 },
  statusBadgeActive: { backgroundColor: '#E5F3E6' },
  statusBadgeInactive: { backgroundColor: '#FBEAEA' },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  statusActive: { color: colors.brandSuccess },
  statusInactive: { color: colors.brandDanger },
  operatorActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  operatorActionButton: { flex: 1, height: 40 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  searchPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 22,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
  },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 15, color: colors.textPrimary, padding: 0 },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeFilters: { color: colors.brandAccent, fontSize: 12, marginBottom: 8 },
  selectionBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  selectionCount: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  selectionAction: { fontSize: 13, fontWeight: '600', color: colors.brandPrimary },
  downloadFab: {
    position: 'absolute',
    right: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: colors.black,
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  downloadFabBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.brandAccent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: colors.brandPrimary,
  },
  downloadFabBadgeText: { color: colors.white, fontSize: 11, fontWeight: '700' },
  list: { paddingBottom: 16, paddingTop: 4 },
  menuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.2)' },
  menuCard: {
    position: 'absolute',
    top: 90,
    right: 16,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingVertical: 6,
    minWidth: 220,
    elevation: 4,
    shadowColor: colors.black,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  menuItem: { paddingVertical: 12, paddingHorizontal: 16 },
  menuItemText: { fontSize: 14, color: colors.textPrimary },
  menuItemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  progressBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  progressCard: { backgroundColor: colors.surface, borderRadius: 12, padding: 20 },
  signingOutCard: { backgroundColor: colors.surface, borderRadius: 12, padding: 24, alignItems: 'center' },
  signingOutText: { marginTop: 12, fontSize: 14, color: colors.textPrimary, fontWeight: '600' },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressTitle: { fontSize: 17, fontWeight: '700', color: colors.brandPrimary },
  progressCancel: { padding: 4 },
  operatorFilterLabel: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginTop: 16, marginBottom: 6 },
  buttonRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  flexButton: { flex: 1 },
  progressMessage: { fontSize: 13, color: colors.textSecondary, marginTop: 4, marginBottom: 16 },
  progressBarTrack: { height: 10, borderRadius: 5, backgroundColor: colors.divider, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: colors.brandAccent },
  progressPercent: { textAlign: 'right', fontSize: 13, fontWeight: '700', color: colors.brandPrimary, marginTop: 8 },
  addOperatorBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  addOperatorScrollContent: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  addOperatorSubmit: { marginTop: 8 },
  addOperatorCancel: { marginTop: 4 },
});
