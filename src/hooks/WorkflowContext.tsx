import React, { createContext, useContext, useRef, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TestRecord, createTestRecord, STATUS_COMPLETED } from '../models/TestRecord';
import { saveRecord, loadRecord } from '../services/recordRepository';
import { clearNavigationState, isSessionStillAlive } from '../services/navigationPersistence';

/** Exported so App.tsx can check for a resumable record BEFORE this provider has even mounted
 *  (needed to decide whether to override NavigationContainer's initialState) without duplicating
 *  the key string — see navigationPersistence.ts's own doc for why both pieces are needed. */
export const KEY_ACTIVE_RECORD_ID = 'active_record_id';

/** Loads the resumable record BEFORE WorkflowProvider ever mounts, so its result can be passed in
 *  as `initialRecord` instead of loaded internally after the fact. This used to happen in a
 *  useEffect inside WorkflowProvider itself, which caused a real bug: every wizard screen
 *  initializes its own form fields via `useState(record.donor.firstName ?? '')` -- a one-time
 *  initializer that only runs on that screen's own first render and never re-syncs later. When a
 *  restored navigation stack mounts several screens at once (see navigationPersistence.ts), all of
 *  them mounted BEFORE this async load had finished, so every one of them captured the still-empty
 *  default record and just... stayed empty, even after the real data loaded in a moment later.
 *  Resolving this before the provider (and therefore every screen) ever mounts means every
 *  screen's very first render already sees the correct data.
 *
 *  Also where the "was this session actually still alive" gate lives (see
 *  navigationPersistence.ts#isSessionStillAlive's own doc) -- a resumable record technically
 *  existing on disk isn't enough on its own; if the app was genuinely closed and reopened much
 *  later, this returns null on purpose so the caller starts fresh, same as a first-ever launch. */
export async function loadResumableRecord(): Promise<TestRecord | null> {
  if (!(await isSessionStillAlive())) return null;
  try {
    const pendingId = await AsyncStorage.getItem(KEY_ACTIVE_RECORD_ID);
    if (!pendingId) return null;
    const resumed = await loadRecord(pendingId);
    if (resumed && resumed.status !== STATUS_COMPLETED) return resumed;
    return null;
  } catch {
    return null;
  }
}

/**
 * Holds the donor test record currently being filled in across the multi-screen wizard — mirrors
 * WorkflowViewModel.java's role, adapted to React's data flow.
 *
 * The native ViewModel lets every screen mutate the SAME record object directly in place
 * (`viewModel.getRecord().donor.firstName = ...`) since Java has no equivalent of React's
 * immutable-state convention. This context keeps that same direct-mutation shape (via a ref, so
 * dozens of screens can each just reach in and set a field the same way the native fragments do)
 * rather than forcing every screen to thread immutable updates through — that would be a much
 * bigger structural change than a faithful port calls for. `updateRecord()` is the one place that
 * actually triggers a re-render, for screens that need to reflect a change (e.g. after loading a
 * cloud profile); most field edits just mutate directly and call `saveDraft()` when leaving a
 * screen, exactly matching the native saveDraft() call sites.
 *
 * Also mirrors the crash-recovery design: the active record's id is persisted to AsyncStorage
 * (this app's equivalent of SavedStateHandle surviving process death) so a killed-and-restarted
 * app (e.g. backgrounded during a camera screen, reclaimed under memory pressure) can reload the
 * in-progress draft straight back off disk by id, the same recovery path WorkflowViewModel's own
 * doc comment describes.
 */
interface WorkflowContextValue {
  record: TestRecord;
  /** Bumps the render tick so screens reading `record` re-render after an external mutation
   *  (e.g. a background profile fetch patched several fields at once). */
  updateRecord: (mutator: (record: TestRecord) => void) => void;
  startNew: () => void;
  saveDraft: () => Promise<void>;
  clear: () => Promise<void>;
  ready: boolean;
}

const WorkflowContext = createContext<WorkflowContextValue | null>(null);

export function WorkflowProvider({
  children,
  initialRecord,
}: {
  children: React.ReactNode;
  /** Pre-loaded by App.tsx via loadResumableRecord() BEFORE this provider ever mounts -- see that
   *  function's own doc for the real bug (empty-looking form screens) this avoids by not loading
   *  it here, after the fact, in a useEffect. */
  initialRecord?: TestRecord | null;
}) {
  const recordRef = useRef<TestRecord>(initialRecord ?? createTestRecord());
  const [tick, setTick] = useState(0);
  // Always true now -- the one-time async load this used to gate on on happens in App.tsx BEFORE
  // this provider mounts at all (see initialRecord's own doc), so there's no longer a real loading
  // window for this provider itself to represent. Left in the exposed context value rather than
  // removed outright since it's a reasonable thing for a future screen to want to check.
  const ready = true;

  const startNew = useCallback(() => {
    recordRef.current = createTestRecord();
    void AsyncStorage.setItem(KEY_ACTIVE_RECORD_ID, recordRef.current.id);
    // A stale saved nav position from a previously-abandoned (never completed, never explicitly
    // cleared) test shouldn't get restored underneath this brand-new, empty record on some future
    // cold start -- see navigationPersistence.ts's own doc.
    void clearNavigationState();
    setTick((t) => t + 1);
  }, []);

  const updateRecord = useCallback((mutator: (record: TestRecord) => void) => {
    mutator(recordRef.current);
    setTick((t) => t + 1);
  }, []);

  const saveDraft = useCallback(async () => {
    try {
      await saveRecord(recordRef.current);
    } catch {
      // Best-effort: if this particular write fails, the in-memory copy remains correct for the
      // rest of this session regardless — same as the native app's saveDraft().
    }
  }, []);

  const clear = useCallback(async () => {
    recordRef.current = createTestRecord();
    await AsyncStorage.removeItem(KEY_ACTIVE_RECORD_ID);
    await clearNavigationState();
    setTick((t) => t + 1);
  }, []);

  // tick is intentionally unused directly — its only job is to be a dependency that changes, so
  // consumers of this context re-render when updateRecord()/startNew()/clear() bump it.
  void tick;

  return (
    <WorkflowContext.Provider value={{ record: recordRef.current, updateRecord, startNew, saveDraft, clear, ready }}>
      {children}
    </WorkflowContext.Provider>
  );
}

export function useWorkflow(): WorkflowContextValue {
  const ctx = useContext(WorkflowContext);
  if (!ctx) throw new Error('useWorkflow must be used within a WorkflowProvider');
  return ctx;
}
