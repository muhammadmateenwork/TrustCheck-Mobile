import NetInfo from '@react-native-community/netinfo';
import { retryPendingSyncs } from './cloudSync';

/** Tracks whether the last known connectivity state was "online" — null means not yet known
 *  (before the first NetInfo event arrives). Module-level since startAutoSync() is only ever
 *  called once, from App.tsx. */
let previouslyOnline: boolean | null = null;
let unsubscribe: (() => void) | null = null;

/**
 * Completed-but-unsynced records previously only got retried when the operator happened to visit
 * History (see cloudSync.retryPendingSyncs's own doc). That's fine once someone's actively using
 * the app, but a record finished right as the connection drops sat unsynced until someone
 * happened back to that screen — this instead retries the moment connectivity actually comes
 * back, wherever the operator is in the app, including right at launch if already online. Drafts
 * (not yet marked COMPLETED) are deliberately still never synced — see retryPendingSyncs' own
 * per-record COMPLETED check — only what's already finished waits on a connection this way.
 *
 * Call once, from App.tsx.
 */
export function startAutoSync(): void {
  if (unsubscribe) return;
  unsubscribe = NetInfo.addEventListener((state) => {
    const online = !!state.isConnected && state.isInternetReachable !== false;
    if (online && previouslyOnline !== true) {
      void retryPendingSyncs();
    }
    previouslyOnline = online;
  });
}
