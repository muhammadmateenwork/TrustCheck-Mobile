/**
 * Mirrors OperatorConsent.java. Field name kept as `qualificationAvailable` (not renamed to
 * something like `nzqaQualified`) deliberately — this app writes to the SAME Firestore
 * `testRecords` collection as the native Android app, and keeping the field name identical is
 * what lets records from either app read back correctly everywhere (PDF, admin detail view,
 * Firestore itself) without needing to handle two different field names for the same fact. Only
 * what's SHOWN to the operator changes here: the native app labels this "Qualification
 * available?" with "NZ Qualified" / "Not NZ Qualified" options; this app labels the exact same
 * field "NZQA qualified?" with "Yes" / "No" — see OperatorConsentScreen.
 */
export interface OperatorConsent {
  operatorName: string | null;
  operatorId: string | null;
  qualificationAvailable: boolean | null;
  phoneNumber: string | null;
  agreedNoDataMisuse: boolean;
  signaturePath: string | null;
}

export function createOperatorConsent(): OperatorConsent {
  return {
    operatorName: null,
    operatorId: null,
    qualificationAvailable: null,
    phoneNumber: null,
    agreedNoDataMisuse: false,
    signaturePath: null,
  };
}

function notEmpty(s: string | null | undefined): boolean {
  return !!s && s.trim().length > 0;
}

export function isOperatorConsentComplete(consent: OperatorConsent): boolean {
  return (
    notEmpty(consent.operatorName) &&
    notEmpty(consent.operatorId) &&
    consent.qualificationAvailable != null &&
    notEmpty(consent.phoneNumber) &&
    consent.agreedNoDataMisuse &&
    notEmpty(consent.signaturePath)
  );
}
