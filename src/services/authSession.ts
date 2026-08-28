import { signInAnonymously, getIdTokenResult, signOut as firebaseSignOut } from 'firebase/auth';
import { firebaseAuth } from './firebase';

/** Mirrors AuthSession.java. Every app instance needs at least an anonymous Firebase Auth
 *  session (see App.tsx, which calls ensureAnonymousSession() on startup) so cloud sync/email
 *  Cloud Functions always have *some* auth context to work with, even before an operator signs
 *  in for real. */

export const ROLE_ADMIN = 'admin';
export const ROLE_OPERATOR = 'operator';

/** New operator accounts (self-signup via the Login screen, or admin-created via the Admin
 *  panel) are restricted to this company email domain. This is only a client-side convenience
 *  check — functions/index.js's own OPERATOR_EMAIL_DOMAIN constant is the actual enforcement
 *  point (createOperator rejects any other domain server-side regardless of what the client
 *  sends), so the two have to be kept in sync by hand. */
export const OPERATOR_EMAIL_DOMAIN = '@ghella.com';

/**
 * Custom claims (role) live inside the ID token itself, not a plain Firestore field a client
 * read could see directly — this is what makes them safe to gate admin-only Cloud Functions on.
 * getIdTokenResult(false) reuses the cached token when still valid rather than forcing a network
 * round trip on every check; both places a role is ever granted (bootstrapAdmin, createOperator)
 * happen before the affected account's first sign-in, so the claim is already present the first
 * time this ever runs for that account.
 *
 * @returns "admin", "operator", or null (anonymous session, or a real account with neither claim
 *          — shouldn't normally happen, but treated as "no special access" rather than throwing).
 */
export async function getRole(): Promise<string | null> {
  const user = firebaseAuth.currentUser;
  if (!user || user.isAnonymous) return null;
  try {
    const result = await getIdTokenResult(user, false);
    const role = result.claims.role;
    return typeof role === 'string' ? role : null;
  } catch (e) {
    console.warn('Could not read role claim', e);
    return null;
  }
}

export async function ensureAnonymousSession(): Promise<void> {
  // initializeAuth's AsyncStorage-backed persistence (see firebase.ts) rehydrates a previously
  // signed-in user ASYNCHRONOUSLY -- firebaseAuth.currentUser can still read null for a brief
  // window right after app launch even when a real operator's session IS persisted and about to
  // load back in. Checking currentUser here without first awaiting authStateReady() raced that
  // rehydration on a real device: a genuinely logged-in operator who fully closed and reopened the
  // app could have this fire first, see no current user yet, and sign in anonymously -- silently
  // replacing the about-to-be-restored real session, which is exactly what a client report ("test
  // was performed as guest mode" after a close/reopen, "Go to Home" then showing Login) matches.
  // authStateReady() resolves only once Firebase's own initial state determination (including
  // that persisted-session read) has actually finished, so currentUser is trustworthy after it.
  await firebaseAuth.authStateReady();
  if (firebaseAuth.currentUser) return;
  try {
    await signInAnonymously(firebaseAuth);
  } catch (e) {
    console.warn('Anonymous auth session not established yet', e);
  }
}

export async function signOutAndResetAnonymous(): Promise<void> {
  await firebaseSignOut(firebaseAuth);
  await ensureAnonymousSession();
}
