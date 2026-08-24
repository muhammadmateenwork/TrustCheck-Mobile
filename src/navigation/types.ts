/** Mirrors app/src/main/res/navigation/nav_graph.xml's destination list and params exactly, so
 *  the screen flow matches the native app one-to-one. */
export type RootStackParamList = {
  Consent: undefined;
  Setup: undefined;
  Login: undefined;
  ForgotPassword: undefined;
  AdminLogin: undefined;
  Admin: undefined;
  DonorData: undefined;
  TestSetup: undefined;
  OperatorConsent: undefined;
  /** scannedQrRaw/scannedAt are set by QrScanScreen navigating back here with a merged param
   *  update (see resetTo-style navigation.navigate({ name, params, merge: true }) in
   *  QrScanScreen) rather than a callback prop — React Navigation params must stay
   *  serializable. scannedAt (a timestamp) exists purely so re-scanning the exact same code
   *  twice in a row still changes the params object and re-fires TestKitScreen's effect. */
  TestKit: { scannedQrRaw?: string; scannedAt?: number } | undefined;
  /** photoPath/readValid/detectionAttempted/scanAt are set by DrugCassetteScanScreen navigating
   *  back here with a merged param update — same pattern as TestKit/QrScan, and the direct RN
   *  equivalent of the native DrugCassetteScanActivity's onActivityResult extras
   *  (EXTRA_PHOTO_PATH/EXTRA_READ_VALID/EXTRA_DETECTION_ATTEMPTED/EXTRA_OVERALL_RESULT/
   *  EXTRA_SUBSTANCE_RESULTS — overallResult/substanceResults are applied directly to the
   *  workflow record by DrugCassetteScanScreen before navigating back, same as the native
   *  fragment does, so they don't need to round-trip through params too). */
  DrugTestPicture: { photoPath?: string; readValid?: boolean; detectionAttempted?: boolean; scanAt?: number } | undefined;
  /** Modal camera screen — equivalent of the native DrugCassetteScanActivity. */
  DrugCassetteScan: undefined;
  DrugResult: undefined;
  AlcoholTest: undefined;
  FinalSignOff: undefined;
  Summary: undefined;
  History: undefined;
  OperatorProfile: undefined;
  /** Equivalent of the native PdfViewerActivity. */
  PdfViewer: { pdfPath: string; title: string };
  /** Modal camera screen — equivalent of the native QrScanActivity. */
  QrScan: undefined;
};
