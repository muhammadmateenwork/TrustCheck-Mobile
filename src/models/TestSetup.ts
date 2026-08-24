/** Mirrors TestSetup.java. */
export interface TestSetup {
  company: string | null;
  testingSite: string | null;
  reasonForTest: string | null;
  supervisorOnSite: string | null; // optional
  supportPerson: string | null; // optional
  resultRecipient: string | null;
  recipientEmail: string | null;
  location: string | null;
}

export const REASON_FOR_TEST_OPTIONS = [
  'Random',
  'Reasonable cause',
  'Post incident',
  'Pre-employment',
  'Blanket',
  'Other',
] as const;

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function createTestSetup(): TestSetup {
  return {
    company: null,
    testingSite: null,
    reasonForTest: null,
    supervisorOnSite: null,
    supportPerson: null,
    resultRecipient: null,
    recipientEmail: null,
    location: null,
  };
}

function notEmpty(s: string | null | undefined): boolean {
  return !!s && s.trim().length > 0;
}

export function isValidEmail(email: string | null | undefined): boolean {
  return !!email && EMAIL_PATTERN.test(email.trim());
}

export function isTestSetupComplete(setup: TestSetup): boolean {
  return (
    notEmpty(setup.company) &&
    notEmpty(setup.testingSite) &&
    notEmpty(setup.reasonForTest) &&
    notEmpty(setup.resultRecipient) &&
    isValidEmail(setup.recipientEmail) &&
    notEmpty(setup.location)
  );
}
