import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationState } from '@react-navigation/native';

const KEY_NAV_STATE = 'last_navigation_state';

/**
 * Persists the full navigation stack (not just the current screen) so a killed-and-restarted app
 * can reopen exactly where the operator left off, not just at the initial route. Paired with
 * WorkflowContext's own record-recovery (see that file's doc) -- that recovers the DATA, this
 * recovers the SCREEN/POSITION, and neither alone was enough: without this, a resumed record was
 * silently sitting in memory while the operator still landed back on the Consent screen, which is
 * indistinguishable from "the app just started over" even though the data was technically fine.
 *
 * Saved on every navigation state change (App.tsx's own NavigationContainer onStateChange), but
 * only ever READ as an initialState override when there's also an active in-progress record (see
 * App.tsx) -- otherwise a stale state from browsing History/Admin in an unrelated earlier session
 * would reopen the app in a confusing spot instead of the normal Consent start.
 */
export async function saveNavigationState(state: NavigationState | undefined): Promise<void> {
  if (!state) return;
  try {
    await AsyncStorage.setItem(KEY_NAV_STATE, JSON.stringify(state));
  } catch {
    // Best-effort, same as WorkflowContext's own saveDraft() -- losing this just means falling
    // back to the normal Consent start, not a hard failure.
  }
}

export async function loadNavigationState(): Promise<NavigationState | undefined> {
  try {
    const raw = await AsyncStorage.getItem(KEY_NAV_STATE);
    return raw ? (JSON.parse(raw) as NavigationState) : undefined;
  } catch {
    return undefined;
  }
}

export async function clearNavigationState(): Promise<void> {
  await AsyncStorage.removeItem(KEY_NAV_STATE);
}

const KEY_LAST_BACKGROUNDED_AT = 'last_backgrounded_at';

/** How long a session stays "resumable" after the app goes to the background. Explicit product
 *  requirement: resuming into a mid-test screen should only happen when the operator briefly
 *  switched apps and the OS reclaimed the process in the meantime (a phone call, checking
 *  something, the camera app) -- not when they deliberately closed the app and came back much
 *  later, which should read as a fresh start, same as a genuinely new session. There's no reliable
 *  OS-level signal in Expo/RN for "was this task swiped away from recents" vs. "silently killed
 *  under memory pressure while still in recents" -- both look identical to the app on the next
 *  cold start -- so this uses a time-based proxy instead: however long the app was in the
 *  background is recorded right when it backgrounds (see App.tsx's AppState listener), and a cold
 *  start only treats the session as still "alive" if that gap is under this threshold. */
const SESSION_ALIVE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

export async function markBackgrounded(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_LAST_BACKGROUNDED_AT, String(Date.now()));
  } catch {
    // Best-effort -- worst case, a subsequent cold start treats the session as not-alive and
    // starts fresh instead of resuming, which is the safe direction to fail in.
  }
}

/** True if the app backgrounded recently enough to still count as the "same session" -- see
 *  SESSION_ALIVE_THRESHOLD_MS's own doc. False (including on a genuinely first-ever launch, where
 *  no timestamp exists at all) means App.tsx should skip resuming navigation/record state and
 *  start fresh at Consent, same as the native app's own SavedStateHandle would only survive actual
 *  process death, not an explicit user close. */
export async function isSessionStillAlive(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(KEY_LAST_BACKGROUNDED_AT);
    if (!raw) return false;
    const backgroundedAt = Number(raw);
    if (!Number.isFinite(backgroundedAt)) return false;
    return Date.now() - backgroundedAt <= SESSION_ALIVE_THRESHOLD_MS;
  } catch {
    return false;
  }
}
