import { collection, getDocs, query, orderBy, limit, startAfter, QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { firestore, functions } from './firebase';
import { Operator } from '../models/Operator';

/**
 * All the Admin-panel-only operations: listing/managing operator accounts. The actual privileged
 * work (creating/disabling/deleting a Firebase Auth user, granting the operator custom claim) all
 * happens server-side in the same Cloud Functions the native app already uses
 * (functions/index.js, untouched) — this is just a thin client for those, plus the plain
 * Firestore read for the operators list itself (allowed directly by firestore.rules for the
 * admin claim). Mirrors AdminRepository.java.
 */

/** Every operator's {uid, email} — deliberately unbounded, unlike listOperatorsPage below. Used
 *  only to populate the Records tab's "Filter by operator" dropdown (see FilterModal), which
 *  needs the complete set of operators to offer as options regardless of how far the separate,
 *  paginated Operators tab list has been scrolled — that dropdown's own FlatList is already
 *  virtualized, so holding every email in memory there isn't the scaling concern; reading every
 *  operator DOCUMENT on every Records-tab visit to render the Operators tab's own list was. */
export async function listAllOperatorEmails(): Promise<Operator[]> {
  const snapshot = await getDocs(collection(firestore, 'operators'));
  const operators: Operator[] = [];
  snapshot.forEach((d) => {
    const email = d.get('email') as string | undefined;
    const active = d.get('active') as boolean | undefined;
    if (email) {
      operators.push({ uid: d.id, email, active: active == null || active });
    }
  });
  operators.sort((a, b) => a.email.localeCompare(b.email, undefined, { sensitivity: 'base' }));
  return operators;
}

export interface OperatorsPage {
  operators: Operator[];
  cursor: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

/** Paginated, alphabetical-by-email read of the operators collection for the Operators tab's own
 *  list — same shape and same reasoning as cloudSync.fetchAllRecordsPage: reading every operator
 *  document up front (the previous behavior) doesn't scale once there are hundreds/thousands of
 *  accounts. Search text and the active/inactive filter are applied client-side to whatever pages
 *  have been loaded so far, same tradeoff fetchAllRecordsPage's own doc explains for Records. */
export async function listOperatorsPage(
  cursor: QueryDocumentSnapshot<DocumentData> | null,
  pageSize: number
): Promise<OperatorsPage> {
  const operatorsRef = collection(firestore, 'operators');
  const clauses = [orderBy('email'), limit(pageSize)];
  if (cursor) clauses.push(startAfter(cursor) as never);

  const snapshot = await getDocs(query(operatorsRef, ...(clauses as never[])));
  const docs = snapshot.docs;
  const hasMore = docs.length === pageSize;
  const newCursor = docs.length > 0 ? docs[docs.length - 1] : cursor;

  const operators: Operator[] = [];
  for (const d of docs) {
    const email = d.get('email') as string | undefined;
    const active = d.get('active') as boolean | undefined;
    if (email) operators.push({ uid: d.id, email, active: active == null || active });
  }
  return { operators, cursor: newCursor, hasMore };
}

export async function createOperator(email: string, password: string): Promise<void> {
  await httpsCallable(functions, 'createOperator')({ email, password });
}

export async function deactivateOperator(uid: string): Promise<void> {
  await httpsCallable(functions, 'deactivateOperator')({ uid });
}

export async function reactivateOperator(uid: string): Promise<void> {
  await httpsCallable(functions, 'reactivateOperator')({ uid });
}

export async function deleteOperator(uid: string): Promise<void> {
  await httpsCallable(functions, 'deleteOperator')({ uid });
}
