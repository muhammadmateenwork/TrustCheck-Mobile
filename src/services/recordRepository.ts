import * as FileSystem from 'expo-file-system/legacy';
import { TestRecord, touch } from '../models/TestRecord';
import { recordJsonPath } from './fileStorage';

/**
 * Local-only persistence for donor test records: one JSON file per record under the app's
 * private document directory. No database, no network storage — mirrors RecordRepository.java.
 *
 * The native app protects concurrent save()/load() calls with a shared lock, since several Java
 * threads can call it at once. JavaScript's single-threaded event loop makes that unnecessary
 * here — awaited file operations from different call sites never interleave their actual
 * read/write syscalls the way OS threads sharing memory could.
 */
export async function saveRecord(record: TestRecord): Promise<void> {
  touch(record);
  const path = await recordJsonPath(record.id);
  await FileSystem.writeAsStringAsync(path, JSON.stringify(record));
}

export async function loadRecord(id: string): Promise<TestRecord | null> {
  const path = await recordJsonPath(id);
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) return null;
  try {
    const text = await FileSystem.readAsStringAsync(path);
    return JSON.parse(text) as TestRecord;
  } catch {
    // A truncated/partial write (process killed mid-save) is exactly the scenario this
    // repository exists to survive — fail soft rather than throw, same as the native app's
    // JsonParseException catch.
    return null;
  }
}

export async function deleteRecord(id: string): Promise<void> {
  const { deleteRecordFiles } = await import('./fileStorage');
  await deleteRecordFiles(id);
}
