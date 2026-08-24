import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { firebaseAuth } from './firebase';

/** Firebase requires a recent sign-in for a sensitive change like this (it'll otherwise reject
 *  updatePassword on a session that's been open a while) — asking for the current password up
 *  front and re-authenticating with it sidesteps that entirely. Mirrors ChangePasswordDialog.java. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const user = firebaseAuth.currentUser;
  if (!user || !user.email) throw new Error('Not signed in');
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  try {
    await reauthenticateWithCredential(user, credential);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
      throw new Error('Current password is incorrect');
    }
    // Any other failure (no network, auth/too-many-requests, auth/user-disabled, etc.) is a
    // different problem than a wrong password — reporting it as one sends the operator into a
    // loop of re-entering a password that was actually correct.
    throw new Error(`Could not verify current password: ${(e as Error).message}`);
  }
  await updatePassword(user, newPassword);
}
