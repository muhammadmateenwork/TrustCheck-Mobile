/** Shared result constants used across drug and alcohol test outcomes — mirrors ResultValue.java. */
export const ResultValue = {
  NEGATIVE: 'NEGATIVE',
  NON_NEGATIVE: 'NON_NEGATIVE',
} as const;

export type ResultValueType = typeof ResultValue[keyof typeof ResultValue];
