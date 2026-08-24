import { TestRecord, donorFullName } from './TestRecord';
import { ResultValue } from './ResultValue';

/** Search/filter/sort state for the History list, and the pure function that applies it. Mirrors
 *  HistoryFilter.java. */
export type Sort = 'NEWEST_FIRST' | 'OLDEST_FIRST' | 'NAME_A_Z' | 'NAME_Z_A';
export type ResultOption = 'ALL' | 'NEGATIVE_OR_PASS' | 'NON_NEGATIVE_OR_FAIL';

export interface HistoryFilter {
  searchQuery: string;
  sort: Sort;
  drugFilter: ResultOption;
  alcoholFilter: ResultOption;
}

export function createHistoryFilter(): HistoryFilter {
  return { searchQuery: '', sort: 'NEWEST_FIRST', drugFilter: 'ALL', alcoholFilter: 'ALL' };
}

export function isDefaultFilter(filter: HistoryFilter): boolean {
  return (
    filter.searchQuery === '' &&
    filter.sort === 'NEWEST_FIRST' &&
    filter.drugFilter === 'ALL' &&
    filter.alcoholFilter === 'ALL'
  );
}

function containsIgnoreCase(value: string | null | undefined, query: string): boolean {
  return !!value && value.toLowerCase().includes(query);
}

function matchesSearch(record: TestRecord, query: string): boolean {
  return (
    containsIgnoreCase(donorFullName(record), query) ||
    containsIgnoreCase(record.donor.donorId, query) ||
    containsIgnoreCase(record.donor.testNumber, query) ||
    containsIgnoreCase(record.testSetup.company, query) ||
    containsIgnoreCase(record.testSetup.testingSite, query) ||
    containsIgnoreCase(record.operatorConsent.operatorName, query)
  );
}

function matchesResult(filter: ResultOption, actual: string | null): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'NEGATIVE_OR_PASS') return actual === ResultValue.NEGATIVE;
  return actual === ResultValue.NON_NEGATIVE;
}

function comparator(sort: Sort): (a: TestRecord, b: TestRecord) => number {
  switch (sort) {
    case 'OLDEST_FIRST':
      return (a, b) => a.createdAt - b.createdAt;
    case 'NAME_A_Z':
      return (a, b) => donorFullName(a).localeCompare(donorFullName(b), undefined, { sensitivity: 'base' });
    case 'NAME_Z_A':
      return (a, b) => donorFullName(b).localeCompare(donorFullName(a), undefined, { sensitivity: 'base' });
    case 'NEWEST_FIRST':
    default:
      return (a, b) => b.createdAt - a.createdAt;
  }
}

export function applyHistoryFilter(filter: HistoryFilter, records: TestRecord[]): TestRecord[] {
  const query = filter.searchQuery.trim().toLowerCase();
  const result = records.filter((record) => {
    if (query !== '' && !matchesSearch(record, query)) return false;
    if (!matchesResult(filter.drugFilter, record.drugResult.overallResult)) return false;
    if (!matchesResult(filter.alcoholFilter, record.alcoholResult.firstTestResult)) return false;
    return true;
  });
  result.sort(comparator(filter.sort));
  return result;
}

export function describeSort(sort: Sort): string {
  switch (sort) {
    case 'OLDEST_FIRST': return 'Oldest first';
    case 'NAME_A_Z': return 'Donor name (A–Z)';
    case 'NAME_Z_A': return 'Donor name (Z–A)';
    case 'NEWEST_FIRST':
    default: return 'Newest first';
  }
}
