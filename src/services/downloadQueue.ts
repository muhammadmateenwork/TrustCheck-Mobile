import { useEffect, useState } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import BackgroundService from 'react-native-background-actions';
import { TestRecord, donorFullName } from '../models/TestRecord';
import { generateRecordPdf, zipPdfPaths } from './reportExport';

export type JobStatus = 'queued' | 'running' | 'paused' | 'completed' | 'cancelled' | 'error';

export interface DownloadJob {
  id: string;
  label: string;
  summaries: TestRecord[];
  mediaUrlsByRecordId: Record<string, Record<string, string>>;
  status: JobStatus;
  completed: number;
  total: number;
  currentName: string;
  pdfPaths: string[];
  resultPath: string | null;
  isZip: boolean;
  error: string | null;
  createdAt: number;
  /** True once saveResultToDownloads has actually succeeded for this job (saved to a public
   *  folder on Android, or handed off via the iOS share sheet) — lives on the job itself, not
   *  local component state, so the Downloads panel still shows "Saved" if the operator closes and
   *  reopens it rather than reverting back to "Save" just because the panel remounted. */
  saved: boolean;
}

/**
 * Module-level job queue (not React state) so it keeps running across screen unmounts/navigation —
 * a job started from Admin's Records tab must survive the operator switching to the Operators tab,
 * backgrounding the app, or even the screen itself unmounting. React components observe it via
 * useDownloadJobs()'s subscription below, they never own it.
 *
 * One job runs at a time (runQueueUntilDrained below), queued FIFO — "downloading multiple in
 * parallel" in the product sense (queue up a second batch while the first is still going, without
 * it breaking) is satisfied by this: a newly enqueued job just waits its turn rather than
 * colliding with the in-flight one. True concurrent PDF generation isn't meaningfully faster on a
 * phone CPU and would only add complexity for no real benefit.
 *
 * Background continuation (surviving the app being minimized or fully closed/swiped from recents)
 * is real, not simulated — see ensureRunnerStarted below: the actual queue-draining loop is handed
 * to react-native-background-actions as the task body of a genuine Android foreground service +
 * headless JS task, the same mechanism GPS trackers and step counters use to keep running past app
 * closure. It does NOT survive the user explicitly Force Stopping the app from Android Settings, or
 * an aggressive OEM battery optimizer killing it — no app, including Play Store's own downloader,
 * can survive those.
 */
let jobs: DownloadJob[] = [];
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function updateJob(id: string, patch: Partial<DownloadJob>) {
  jobs = jobs.map((j) => (j.id === id ? { ...j, ...patch } : j));
  notify();
}

function findJob(id: string): DownloadJob | undefined {
  return jobs.find((j) => j.id === id);
}

export function getDownloadJobs(): DownloadJob[] {
  return jobs;
}

export function subscribeDownloadJobs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook — re-renders whenever any job's state changes. */
export function useDownloadJobs(): DownloadJob[] {
  const [, tick] = useState(0);
  useEffect(() => subscribeDownloadJobs(() => tick((n) => n + 1)), []);
  return jobs;
}

export function activeDownloadJobCount(): number {
  return jobs.filter((j) => j.status === 'queued' || j.status === 'running' || j.status === 'paused').length;
}

export function enqueueDownload(summaries: TestRecord[], mediaUrlsByRecordId: Record<string, Record<string, string>>): string {
  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const label = summaries.length === 1 ? donorFullName(summaries[0]) : `${summaries.length} Reports`;
  const job: DownloadJob = {
    id,
    label,
    summaries,
    mediaUrlsByRecordId,
    status: 'queued',
    completed: 0,
    total: summaries.length,
    currentName: '',
    pdfPaths: [],
    resultPath: null,
    isZip: summaries.length > 1,
    error: null,
    createdAt: Date.now(),
    saved: false,
  };
  jobs = [...jobs, job];
  notify();
  void ensureRunnerStarted();
  return id;
}

export function markJobSaved(id: string): void {
  updateJob(id, { saved: true });
}

export function pauseJob(id: string): void {
  const job = findJob(id);
  if (job && (job.status === 'running' || job.status === 'queued')) updateJob(id, { status: 'paused' });
}

export function resumeJob(id: string): void {
  const job = findJob(id);
  if (job && job.status === 'paused') updateJob(id, { status: 'queued' });
  void ensureRunnerStarted();
}

export function cancelJob(id: string): void {
  const job = findJob(id);
  if (job && (job.status === 'queued' || job.status === 'running' || job.status === 'paused')) {
    updateJob(id, { status: 'cancelled' });
  }
}

export function dismissJob(id: string): void {
  jobs = jobs.filter((j) => j.id !== id);
  notify();
}

class JobCancelledError extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function updateServiceNotification() {
  if (Platform.OS !== 'android') return;
  const active = jobs.find((j) => j.status === 'running');
  if (!active) return;
  const queuedCount = jobs.filter((j) => j.status === 'queued').length;
  try {
    await BackgroundService.updateNotification({
      taskDesc: `${active.label}: ${active.completed}/${active.total}${queuedCount > 0 ? ` · ${queuedCount} more queued` : ''}`,
      progressBar: { max: active.total, value: active.completed, indeterminate: false },
    });
  } catch {
    // Notification update failing (e.g. service already stopped) shouldn't interrupt the export.
  }
}

async function runJob(id: string): Promise<void> {
  const job = findJob(id);
  if (!job) return;
  updateJob(id, { status: 'running' });
  try {
    const pdfPaths = [...job.pdfPaths];
    for (let i = pdfPaths.length; i < job.summaries.length; i++) {
      // Re-check live status every iteration — the job may have been paused/cancelled from the UI
      // since this loop started.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const current = findJob(id);
        if (!current || current.status === 'cancelled') throw new JobCancelledError();
        if (current.status !== 'paused') break;
        await sleep(400);
      }
      const summary = job.summaries[i];
      updateJob(id, { currentName: donorFullName(summary), completed: i });
      await updateServiceNotification();
      const pdfPath = await generateRecordPdf(summary, job.mediaUrlsByRecordId[summary.id] ?? null);
      pdfPaths.push(pdfPath);
      updateJob(id, { pdfPaths, completed: i + 1 });
      await updateServiceNotification();
    }
    const resultPath = pdfPaths.length === 1 ? pdfPaths[0] : await zipPdfPaths(pdfPaths, job.summaries);
    updateJob(id, { status: 'completed', resultPath, currentName: '' });
  } catch (e) {
    if (e instanceof JobCancelledError) {
      updateJob(id, { status: 'cancelled', currentName: '' });
    } else {
      updateJob(id, { status: 'error', error: (e as Error).message, currentName: '' });
    }
  }
}

let queueLoopActive = false;

async function runQueueUntilDrained(): Promise<void> {
  if (queueLoopActive) return;
  queueLoopActive = true;
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const next = jobs.find((j) => j.status === 'queued');
      if (!next) return;
      await runJob(next.id);
    }
  } finally {
    queueLoopActive = false;
  }
}

let starting = false;

/** Starts (or re-triggers) the queue runner. Cheap to call repeatedly — enqueueDownload and
 *  resumeJob both call this unconditionally; it's a no-op if a runner is already active. */
async function ensureRunnerStarted(): Promise<void> {
  if (starting || queueLoopActive) return;
  if (!jobs.some((j) => j.status === 'queued')) return;
  starting = true;
  try {
    if (Platform.OS === 'android') {
      try {
        if (Platform.Version >= 33) {
          await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => null);
        }
        await BackgroundService.start(runQueueUntilDrained, {
          taskName: 'TrustCheckReportExport',
          taskTitle: 'TrustCheck — Preparing reports',
          taskDesc: 'Starting…',
          taskIcon: { name: 'ic_launcher', type: 'mipmap' },
          color: '#0B4F6C',
          foregroundServiceType: ['dataSync'],
          progressBar: { max: 1, value: 0, indeterminate: true },
        });
        return;
      } catch (e) {
        console.log('[downloadQueue] BackgroundService unavailable, running foreground-only:', e);
      }
    }
    void runQueueUntilDrained();
  } finally {
    starting = false;
  }
}
