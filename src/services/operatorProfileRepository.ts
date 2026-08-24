import { doc, getDocFromCache, getDocFromServer, getDoc, setDoc } from 'firebase/firestore';
import { firestore } from './firebase';
import { OperatorProfile, operatorProfileToMap } from '../models/OperatorProfile';

const COLLECTION = 'operators';

/**
 * Cache-first: on a second-or-later login on this device, the operator's own profile they
 * already saved before is sitting in Firestore's local cache, so this returns near-instantly
 * instead of waiting on a network round trip every single time. A background refresh from the
 * server still runs right after (in case the profile was updated from another device), and
 * quietly re-fires the callback only if that turns out to differ from what the cache had.
 * Mirrors OperatorProfileRepository#fetch — may call onLoaded twice for the same call, exactly
 * like the native version.
 */
export async function fetchOperatorProfile(
  uid: string,
  onLoaded: (profile: OperatorProfile | null) => void,
  onError: (e: unknown) => void
): Promise<void> {
  const ref = doc(firestore, COLLECTION, uid);
  let hadCache = false;
  try {
    const cacheDoc = await getDocFromCache(ref);
    hadCache = cacheDoc.exists();
    if (hadCache) {
      onLoaded((cacheDoc.data() as OperatorProfile) ?? null);
    }
  } catch {
    // No local cache at all yet (first login ever on this device) — fall back to a normal fetch,
    // same as the native app's fallback path.
    try {
      const docSnap = await getDoc(ref);
      onLoaded(docSnap.exists() ? ((docSnap.data() as OperatorProfile) ?? null) : null);
    } catch (e) {
      onError(e);
    }
    return;
  }

  try {
    const serverDoc = await getDocFromServer(ref);
    onLoaded(serverDoc.exists() ? ((serverDoc.data() as OperatorProfile) ?? null) : null);
  } catch (e) {
    // Already showed the cached version above; a background refresh failing (e.g. no
    // connectivity right now) isn't worth surfacing.
    if (!hadCache) onError(e);
  }
}

/**
 * Fire-and-forget: an operator's cloud profile is a convenience (so they don't retype their
 * details every test), not something the current test record depends on, so a write failure here
 * must never block or fail the workflow that's already in progress locally. Merges rather than
 * overwrites — this document also carries admin-managed fields this function knows nothing about
 * (active/createdAt/createdBy, see functions/index.js#createOperator and firestore.rules). A
 * plain overwrite would silently wipe those out from under the admin panel, and since
 * firestore.rules require `active` to stay unchanged on an operator's own write, that would
 * actually reject this write outright the moment `active` disappeared. Mirrors
 * OperatorProfileRepository#save.
 */
export function saveOperatorProfile(uid: string, profile: OperatorProfile): Promise<void> {
  profile.updatedAt = Date.now();
  return setDoc(doc(firestore, COLLECTION, uid), operatorProfileToMap(profile), { merge: true });
}
