/**
 * Mirrors one document at operators/{uid} in Firestore. Only exists for operators who signed in
 * — an operator who skips login never has one of these, on Firestore or locally, by design
 * (their details are one-time-use for that single test only). Mirrors OperatorProfile.java.
 *
 * Field name kept as `qualificationAvailable` for the same cross-app compatibility reason as
 * OperatorConsent — see that file's doc comment.
 */
export interface OperatorProfile {
  operatorName: string | null;
  operatorId: string | null;
  qualificationAvailable: boolean | null;
  phoneNumber: string | null;
  email: string | null;
  updatedAt: number;
}

export function operatorProfileToMap(profile: OperatorProfile): Record<string, unknown> {
  return {
    operatorName: profile.operatorName,
    operatorId: profile.operatorId,
    qualificationAvailable: profile.qualificationAvailable,
    phoneNumber: profile.phoneNumber,
    email: profile.email,
    updatedAt: profile.updatedAt,
  };
}
