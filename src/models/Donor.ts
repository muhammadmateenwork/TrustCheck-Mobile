/** Mirrors Donor.java. */
export interface Donor {
  testNumber: string | null; // e.g. "DT 5000"
  donorId: string | null;
  firstName: string | null;
  surname: string | null;
  dateOfBirth: number | null; // epoch millis, null until picked

  /** Whether the donor reports taking medication in the last 7 days. Null until answered. */
  medicationLast7Days: boolean | null;
  medicationDetails: string | null;

  /** Whether the donor has checked the initial consent notice — the consent given before the
   *  test procedure starts, distinct from declarationAgreed below (confirmed afterward,
   *  alongside the signature). Both appear as separate sections on the paper consent form
   *  this mirrors. */
  initialConsentAgreed: boolean;

  /** Whether the donor has checked every declaration on the consent form — tracked as one flag
   *  rather than four, since nothing downstream (PDF, admin view) needs to know which specific
   *  box was which, only that all of them were acknowledged before signing. */
  declarationAgreed: boolean;

  /** Path to the donor's signature image confirming this section. */
  signaturePath: string | null;

  /** Photo of the donor's ID, taken on this screen. Optional — not every donor has ID on hand. */
  idPhotoPath: string | null;
}

export function createDonor(): Donor {
  return {
    testNumber: null,
    donorId: null,
    firstName: null,
    surname: null,
    dateOfBirth: null,
    medicationLast7Days: null,
    medicationDetails: null,
    initialConsentAgreed: false,
    declarationAgreed: false,
    signaturePath: null,
    idPhotoPath: null,
  };
}

function notEmpty(s: string | null | undefined): boolean {
  return !!s && s.trim().length > 0;
}

export function isDonorComplete(donor: Donor): boolean {
  const base =
    notEmpty(donor.donorId) &&
    notEmpty(donor.firstName) &&
    notEmpty(donor.surname) &&
    donor.dateOfBirth != null &&
    donor.medicationLast7Days != null &&
    donor.initialConsentAgreed &&
    donor.declarationAgreed &&
    notEmpty(donor.signaturePath);
  if (!base) return false;
  if (donor.medicationLast7Days === true) {
    return notEmpty(donor.medicationDetails);
  }
  return true;
}
