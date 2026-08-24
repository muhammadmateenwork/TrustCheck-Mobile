/** Admin panel's view of one operators/{uid} document — deliberately not the same type as
 *  OperatorProfile, which is the operator's OWN view of their consent-form details. Both map
 *  onto the same Firestore document, just different subsets of its fields; keeping them separate
 *  means neither side accidentally overwrites fields it doesn't know about (see
 *  operatorProfileRepository.save, which merges rather than overwrites for exactly this reason).
 *  Mirrors Operator.java. */
export interface Operator {
  uid: string;
  email: string;
  active: boolean;
}
