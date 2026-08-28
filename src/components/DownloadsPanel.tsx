import React from 'react';
import { Modal, View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { DownloadJob, useDownloadJobs, pauseJob, resumeJob, cancelJob, dismissJob, markJobSaved } from '../services/downloadQueue';
import { saveResultToDownloads } from '../services/reportExport';
import { useToast } from './Toast';
import { colors } from '../theme';

/** Admin's bulk-download job list — pause/resume/cancel per job, and Save once a job finishes.
 *  See downloadQueue.ts for how jobs actually run (queued, one at a time, backed by a real Android
 *  foreground service so they keep going even if this panel — or the whole app — is closed). */
export default function DownloadsPanel({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const jobs = useDownloadJobs();
  const { showToast } = useToast();

  const onSave = async (job: DownloadJob) => {
    if (!job.resultPath) return;
    try {
      const fileName = job.resultPath.split('/').pop() ?? `TrustCheck_Report_${job.id}${job.isZip ? '.zip' : '.pdf'}`;
      const outcome = await saveResultToDownloads(job.resultPath, job.isZip, fileName);
      markJobSaved(job.id);
      showToast(outcome === 'saved' ? 'Saved to Downloads' : 'Shared', 'success');
    } catch (e) {
      showToast(`Could not save: ${(e as Error).message}`, 'error');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Downloads</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <MaterialIcons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>
          <ScrollView>
            {jobs.length === 0 ? (
              <Text style={styles.emptyText}>No downloads yet — select records and tap the download icon.</Text>
            ) : (
              [...jobs]
                .sort((a, b) => b.createdAt - a.createdAt)
                .map((job) => <JobRow key={job.id} job={job} onSave={() => void onSave(job)} />)
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function JobRow({ job, onSave }: { job: DownloadJob; onSave: () => void }) {
  const percent = job.total > 0 ? Math.round((job.completed / job.total) * 100) : 0;
  const inProgress = job.status === 'running' || job.status === 'paused' || job.status === 'queued';

  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowLabel} numberOfLines={1}>
          {job.label}
        </Text>
        <Text style={[styles.rowStatus, job.status === 'error' && styles.rowStatusError]}>{statusLabel(job.status)}</Text>
      </View>

      {inProgress && (
        <>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${percent}%` }]} />
          </View>
          <Text style={styles.progressText}>
            {job.completed}/{job.total}
            {job.currentName ? ` · ${job.currentName}` : ''}
          </Text>
        </>
      )}
      {job.status === 'error' && job.error && <Text style={styles.errorText}>{job.error}</Text>}

      <View style={styles.actions}>
        {job.status === 'running' && <ActionButton icon="pause" label="Pause" onPress={() => pauseJob(job.id)} />}
        {job.status === 'paused' && <ActionButton icon="play-arrow" label="Resume" onPress={() => resumeJob(job.id)} />}
        {inProgress && <ActionButton icon="close" label="Cancel" onPress={() => cancelJob(job.id)} />}
        {job.status === 'completed' &&
          (job.saved ? (
            <ActionButton icon="check" label="Saved" onPress={onSave} />
          ) : (
            <ActionButton icon="download" label="Save" onPress={onSave} primary />
          ))}
        {!inProgress && <ActionButton icon="delete-outline" label="Remove" onPress={() => dismissJob(job.id)} />}
      </View>
    </View>
  );
}

function statusLabel(status: DownloadJob['status']): string {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'running':
      return 'Downloading…';
    case 'paused':
      return 'Paused';
    case 'completed':
      return 'Ready';
    case 'cancelled':
      return 'Cancelled';
    case 'error':
      return 'Failed';
  }
}

function ActionButton({
  icon,
  label,
  onPress,
  primary,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable style={[styles.actionButton, primary && styles.actionButtonPrimary]} onPress={onPress} hitSlop={4}>
      <MaterialIcons name={icon} size={15} color={primary ? colors.white : colors.brandPrimary} />
      <Text style={[styles.actionButtonText, primary && styles.actionButtonTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 20 },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: 16, maxHeight: '80%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  emptyText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', paddingVertical: 24 },
  row: { borderWidth: 1, borderColor: colors.divider, borderRadius: 10, padding: 12, marginBottom: 10 },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  rowLabel: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginRight: 8 },
  rowStatus: { fontSize: 12, fontWeight: '600', color: colors.brandAccent },
  rowStatusError: { color: colors.brandDanger },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.divider, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.brandAccent },
  progressText: { fontSize: 11, color: colors.textSecondary, marginTop: 4 },
  errorText: { fontSize: 12, color: colors.brandDanger, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.brandPrimary,
  },
  actionButtonPrimary: { backgroundColor: colors.brandPrimary },
  actionButtonText: { fontSize: 12, fontWeight: '600', color: colors.brandPrimary },
  actionButtonTextPrimary: { color: colors.white },
});
