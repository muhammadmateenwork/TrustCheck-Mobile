import { initializeApp, getApps, getApp } from 'firebase/app';
// Imported from the scoped @firebase/auth package, not the top-level `firebase` wrapper: the
// wrapper's own package.json re-export map for "./auth" has no "react-native" condition at all
// (only node/browser/default), so Metro would silently resolve `firebase/auth` to the BROWSER
// build in this RN app — no AsyncStorage-backed session persistence, and no
// getReactNativePersistence export at all. @firebase/auth's own package.json DOES declare a
// proper "react-native" condition (Metro picks it up correctly), so importing from here directly
// is what actually gets the RN-specific build at runtime.
import { initializeAuth, getAuth, Auth } from '@firebase/auth';
// @ts-expect-error — @firebase/auth's package.json lists a bare top-level "types" key ahead of
// its "react-native" condition, so tsc's bundler resolution picks the generic (non-RN) type
// declarations before ever considering the RN-specific ones and doesn't see this export — even
// though Metro resolves the JS correctly at runtime via that same "react-native" condition, and
// the RN build's own .d.ts (dist/rn/index.rn.d.ts) does declare this function. A
// types-resolution-only gap, not a real missing export.
import { getReactNativePersistence } from '@firebase/auth';
import { initializeFirestore, getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Same Firebase project the native Android app uses (project id "trustcheck123" — see
 * app/google-services.json in the native TrustCheck project) so both apps read/write the exact
 * same Auth users, Firestore `testRecords`/`operators` collections, and Cloud Storage bucket.
 * Nothing here needs to change on the backend side for this app to work — see firestore.rules
 * and functions/index.js in the native project, both untouched and shared.
 *
 * apiKey/projectId/storageBucket/messagingSenderId came straight from that google-services.json.
 * appId below is a placeholder — Firebase API keys are not secret (security is enforced by
 * firestore.rules / storage rules, not by hiding this), but `appId` specifically is generated
 * per-registered-app, and no "Web app" has been registered in this Firebase project yet. To get
 * a real one: Firebase Console -> Project Settings -> Add App -> Web (</>) -> register e.g.
 * "TrustCheck Mobile" -> copy the `appId` it gives you into TRUSTCHECK_APP_ID below. Auth/
 * Firestore/Storage/Functions all work fine even with the placeholder; only Analytics/Performance
 * (not used by this app) would need a real one.
 */
const TRUSTCHECK_APP_ID = '1:142483924315:web:REPLACE_WITH_REAL_WEB_APP_ID';

const firebaseConfig = {
  apiKey: 'AIzaSyAKZkFhFlstFDAcxG26G9zM0RPEeXRhxMY',
  authDomain: 'trustcheck123.firebaseapp.com',
  projectId: 'trustcheck123',
  storageBucket: 'trustcheck123.firebasestorage.app',
  messagingSenderId: '142483924315',
  appId: TRUSTCHECK_APP_ID,
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// initializeAuth (with AsyncStorage persistence) can only be called once per app instance — on
// Fast Refresh during development this module can re-evaluate, so fall back to getAuth() if
// Auth's already initialized rather than throwing.
let auth: Auth;
try {
  auth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
} catch (e) {
  // Only swallow the specific "already initialized" case (Fast Refresh re-evaluating this
  // module) — any other error here is a real misconfiguration, and silently falling back to
  // getAuth(app) would mask it while possibly returning an instance without the AsyncStorage
  // persistence just configured above.
  if ((e as { code?: string }).code !== 'auth/already-initialized') throw e;
  auth = getAuth(app);
}

export const firebaseAuth = auth;
// getFirestore(app)'s default transport (gRPC-Web streaming) is unreliable over React Native's
// networking stack (no real WebSocket/HTTP2-streaming support the way a browser has) — this is a
// well-documented Firebase-JS-SDK-on-RN gotcha: reads/writes/listeners can silently hang or fail
// inconsistently rather than throwing a clear error, which is exactly what made cloud sync look
// "sometimes working" from the outside. Forcing long-polling (a plain repeated-HTTP-request
// transport, not real streaming) is the standard fix — same data, same security rules, just a
// transport RN's fetch/XHR stack actually supports properly.
//
// initializeFirestore() can only be called ONCE per app instance — calling it again throws
// "Firestore has already been initialized". Same situation as initializeAuth() above: on Fast
// Refresh during development this module can re-evaluate, and unlike the Auth case this call
// had NO fallback, so that second call's exception was uncaught — silently breaking every
// Firestore operation for the rest of that session (with no crash, no visible error, just
// records that stop syncing/loading) until the app was fully restarted. getFirestore(app) falls
// back to the already-initialized instance (still carrying the long-polling setting from
// whichever call actually created it).
let db;
try {
  db = initializeFirestore(app, { experimentalForceLongPolling: true });
} catch (e) {
  // Same reasoning as the Auth catch above: only swallow Firestore's real "already initialized"
  // error (code 'failed-precondition'). Anything else silently falling back to getFirestore(app)
  // would reintroduce the exact flaky-sync symptom long-polling exists to fix, with zero signal
  // that it happened.
  if ((e as { code?: string }).code !== 'failed-precondition') throw e;
  db = getFirestore(app);
}
export const firestore = db;
export const storage = getStorage(app);
export const functions = getFunctions(app);
export default app;
