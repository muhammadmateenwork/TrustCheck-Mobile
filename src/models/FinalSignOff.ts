/** Mirrors FinalSignOff.java. */
export interface FinalSignOff {
  operatorName: string | null;
  signaturePath: string | null;
}

export function createFinalSignOff(): FinalSignOff {
  return { operatorName: null, signaturePath: null };
}

function notEmpty(s: string | null | undefined): boolean {
  return !!s && s.trim().length > 0;
}

export function isFinalSignOffComplete(signOff: FinalSignOff): boolean {
  return notEmpty(signOff.operatorName) && notEmpty(signOff.signaturePath);
}
