import React, { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TestRecord, createTestRecord, STATUS_COMPLETED } from '../models/TestRecord';
import { saveRecord, loadRecord } from '../services/recordRepository';

const KEY_ACTIVE_RECORD_ID = 'active_record_id';

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

export function WorkflowProvider({ children }: { children: React.ReactNode }) {
  const recordRef = useRef<TestRecord>(createTestRecord());
  const [tick, setTick] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const pendingId = await AsyncStorage.getItem(KEY_ACTIVE_RECORD_ID);
        if (pendingId) {
          const resumed = await loadRecord(pendingId);
          if (resumed && resumed.status !== STATUS_COMPLETED) {
            recordRef.current = resumed;
          }
        }
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const startNew = useCallback(() => {
    recordRef.current = createTestRecord();
    void AsyncStorage.setItem(KEY_ACTIVE_RECORD_ID, recordRef.current.id);
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
