/** Mirrors DateUtils.java's display formatting (JS's Intl API is inherently safe to share across
 *  async callbacks, so none of the ThreadLocal machinery the Java version needs applies here). */

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatDate(epochMillis: number | null | undefined, dayKnown = true): string {
  if (epochMillis == null) return '';
  const d = new Date(epochMillis);
  if (!dayKnown) return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return `${pad2(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDateTime(epochMillis: number | null | undefined): string {
  if (epochMillis == null) return '';
  const d = new Date(epochMillis);
  return `${pad2(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** True if the given date falls before the start of today (i.e. already expired). */
export function isBeforeToday(epochMillis: number): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return epochMillis < today.getTime();
}

/** Last millisecond of the month containing the given date — used when only month/year
 *  granularity is known, so a kit isn't treated as "expired" until its whole expiry month has
 *  actually passed. */
export function endOfMonth(epochMillis: number): number {
  const d = new Date(epochMillis);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
}
