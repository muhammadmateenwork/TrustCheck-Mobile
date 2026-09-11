/** Mirrors app/src/main/res/navigation/nav_graph.xml's destination list and params exactly, so
 *  the screen flow matches the native app one-to-one. */
export type RootStackParamList = {
  Consent: undefined;
  /** justSignedOut is set when this screen is reached right after an explicit Sign Out (see
   *  HistoryScreen's confirmSignOut) -- SetupScreen normally re-derives whether to show its own
   *  Login/Skip choice or auto-redirect past itself by reading firebaseAuth.currentUser fresh on
   *  mount, but that read races the same signOut()+signInAnonymously() sequence that just ran:
   *  Firebase Auth's React Native persistence layer doesn't guarantee `currentUser` reflects the
   *  new (anonymous) session the instant those promises resolve, so SetupScreen could still catch
   *  a stale non-anonymous reference and silently redirect straight back to the operator's old
   *  session, or land on a confusing in-between state -- never actually showing the Login/Skip
   *  choice a Sign Out should always land on. This flag sidesteps that race entirely: when set,
   *  SetupScreen skips the auto-redirect check altogether and always shows the choice. */
  Setup: { justSignedOut?: boolean } | undefined;
  Login: undefined;
  ForgotPassword: undefined;
  AdminLogin: undefined;
  Admin: undefined;
  DonorData: undefined;
  TestSetup: undefined;
  OperatorConsent: undefined;
  /** scannedQrRaw/scannedAt are set by QrScanScreen returning here via setParams(source:
   *  returnToKey) + goBack() — see QrScan's own param doc for why this replaced an earlier
   *  navigate({name, params, merge: true}) pattern that turned out to be unreliable across a
   *  multi-hop stack (confirmed via real on-device nav-stack logging: it silently pushed a fresh
   *  instance instead of collapsing back onto this one, growing the stack by one pair per retry).
   *  scannedAt (a timestamp) exists purely so re-scanning the exact same code twice in a row still
   *  changes the params object and re-fires TestKitScreen's effect. */
  TestKit: { scannedQrRaw?: string; scannedAt?: number } | undefined;
  /** photoPath/readValid/detectionAttempted/scanAt are set by DrugCassetteScanScreen returning
   *  here via setParams(source: returnToKey) + goBack() — the direct RN equivalent of the native
   *  DrugCassetteScanActivity's onActivityResult extras (EXTRA_PHOTO_PATH/EXTRA_READ_VALID/
   *  EXTRA_DETECTION_ATTEMPTED/EXTRA_OVERALL_RESULT/EXTRA_SUBSTANCE_RESULTS — overallResult/
   *  substanceResults are applied directly to the workflow record by DrugCassetteScanScreen
   *  before returning, same as the native fragment does, so they don't need to round-trip
   *  through params too). See DrugCassetteScan's own param doc for why this is goBack-based
   *  rather than a forward navigate. */
  DrugTestPicture: { photoPath?: string; readValid?: boolean; detectionAttempted?: boolean; scanAt?: number } | undefined;
  /** Modal camera screen — equivalent of the native DrugCassetteScanActivity. `mode` is chosen on
   *  DrugTestPictureScreen ("Scan Kit" vs "Take Picture" — two separate buttons there, see that
   *  screen's own doc) and passed in here; this screen no longer asks the operator to choose
   *  again once the camera is open, it just does the one thing already chosen.
   *
   *  `returnToKey` is DrugTestPictureScreen's own `route.key` at the moment it navigated here —
   *  used to return via `navigation.dispatch({ ...CommonActions.setParams(result), source:
   *  returnToKey })` followed by `navigation.goBack()`, rather than
   *  `navigate({ name: 'DrugTestPicture', params, merge: true })`. That merge-navigate pattern
   *  was confirmed (real on-device nav-stack logging, not assumed) to NOT reliably collapse back
   *  onto the existing DrugTestPicture instance once DrugResult had been visited and popped in
   *  between two scan attempts -- it silently pushed a brand new DrugTestPicture (and left this
   *  screen's own instance in the stack too) instead, growing the stack by one full
   *  DrugTestPicture+DrugCassetteScan pair on every single retry. Returning by explicit route key
   *  is unambiguous by construction: goBack() always pops exactly one screen, back to whichever
   *  screen key actually pushed this one, with no "find the right existing instance" step to get
   *  wrong. */
  DrugCassetteScan: { mode: 'scan' | 'manual'; returnToKey: string };
  DrugResult: undefined;
  AlcoholTest: undefined;
  FinalSignOff: undefined;
  Summary: undefined;
  History: undefined;
  /** Company-wide counts-only view (not scoped to the signed-in operator) — filterable by date
   *  range and reason for test, showing how many tests match across every operator, excluding
   *  guest/anonymous sessions, never individual record details (no way to open a record or its
   *  PDF from here). See MyTestCountsScreen's own doc. */
  MyTestCounts: undefined;
  OperatorProfile: undefined;
  /** Equivalent of the native PdfViewerActivity. */
  PdfViewer: { pdfPath: string; title: string };
  /** Modal camera screen — equivalent of the native QrScanActivity. `returnToKey` is
   *  TestKitScreen's own `route.key` at the moment it navigated here — see DrugCassetteScan's own
   *  param doc for why this replaced a forward navigate(merge:true) return. */
  QrScan: { returnToKey: string };
};
