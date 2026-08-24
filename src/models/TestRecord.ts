import { getAuth } from 'firebase/auth';
import { uuidv4 } from '../utils/uuid';
import { Donor, createDonor } from './Donor';
import { TestSetup, createTestSetup } from './TestSetup';
import { OperatorConsent, createOperatorConsent } from './OperatorConsent';
import { TestKitInfo, createTestKitInfo } from './TestKitInfo';
import { DrugResult, createDrugResult } from './DrugResult';
import { AlcoholTestInfo, createAlcoholTestInfo } from './AlcoholTestInfo';
import { AlcoholResult, createAlcoholResult } from './AlcoholResult';
import { FinalSignOff, createFinalSignOff } from './FinalSignOff';

/** Root object for a single donor test workflow, persisted as one JSON file per record locally
 *  and one document per record in Firestore's `testRecords` collection. Mirrors TestRecord.java
 *  field-for-field so records are readable/writable identically by both the native Android app
 *  and this one against the same backend. */
export interface TestRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: string;

  /** The Firebase Auth UID (real login or anonymous session) of whoever performed this test —
   *  stamped once at creation and never changed. Used to scope History to "my tests only," both
   *  locally and in Firestore (see firestore.rules). */
  operatorUid: string;

  donor: Donor;
  testSetup: TestSetup;
  operatorConsent: OperatorConsent;
  testKitInfo: TestKitInfo;
  drugTestPhotoPath: string | null;
  drugResult: DrugResult;
  alcoholTestInfo: AlcoholTestInfo;
  alcoholTestPhotoPath: string | null;
  /** Only set when AlcoholTestInfo has a second test — a separate photo for the confirmatory
   *  second sample, taken and reviewed as its own step after the first test's result. */
  alcoholTestPhotoPath2: string | null;
  alcoholResult: AlcoholResult;
  finalSignOff: FinalSignOff;

  pdfPath: string | null;
  /** User-editable file name (no extension) chosen on the Report screen before saving. */
  pdfDisplayName: string | null;
  emailSent: boolean;

  /** True only once cloud sync has confirmed the Firestore write actually succeeded — not just
   *  that a sync attempt was made. A completed test always saves locally first and succeeds
   *  regardless of this; syncing to the cloud (and therefore showing up in the Admin panel) is a
   *  separate, best-effort step that can fail on a bad connection. Defaults to false for both new
   *  records and old ones loaded from before this field existed — either way, "not yet confirmed
   *  synced" is the correct, safe reading. */
  cloudSynced: boolean;
}

export const STATUS_IN_PROGRESS = 'IN_PROGRESS';
export const STATUS_COMPLETED = 'COMPLETED';

export function createTestRecord(): TestRecord {
  const now = Date.now();
  const user = getAuth().currentUser;
  return {
    id: uuidv4(),
    createdAt: now,
    updatedAt: now,
    status: STATUS_IN_PROGRESS,
    operatorUid: user ? user.uid : '',
    donor: createDonor(),
    testSetup: createTestSetup(),
    operatorConsent: createOperatorConsent(),
    testKitInfo: createTestKitInfo(),
    drugTestPhotoPath: null,
    drugResult: createDrugResult(),
    alcoholTestInfo: createAlcoholTestInfo(),
    alcoholTestPhotoPath: null,
    alcoholTestPhotoPath2: null,
    alcoholResult: createAlcoholResult(),
    finalSignOff: createFinalSignOff(),
    pdfPath: null,
    pdfDisplayName: null,
    emailSent: false,
    cloudSynced: false,
  };
}

export function touch(record: TestRecord): void {
  record.updatedAt = Date.now();
}

export function donorFullName(record: TestRecord): string {
  const first = record.donor.firstName ?? '';
  const last = record.donor.surname ?? '';
  const full = `${first} ${last}`.trim();
  return full === '' ? '(Unnamed donor)' : full;
}
