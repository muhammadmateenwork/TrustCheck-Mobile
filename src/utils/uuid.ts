/** Lightweight RFC4122 v4 UUID generator — not cryptographically secure, but record IDs only
 *  need to be unique, not unguessable (matches the native app's plain UUID.randomUUID() usage),
 *  so this avoids pulling in expo-crypto just for this. */
export function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
