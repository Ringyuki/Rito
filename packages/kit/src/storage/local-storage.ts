import type { AnnotationRecord, RecordStorageAdapter } from '@ritojs/core/annotations';
import type { PositionStorageAdapter } from './types';

/** Persist annotation records to localStorage under the given key. */
export function createLocalStorageAnnotationAdapter(key: string): RecordStorageAdapter {
  return {
    load(): Promise<readonly AnnotationRecord[]> {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return Promise.resolve([]);
        return Promise.resolve(JSON.parse(raw) as AnnotationRecord[]);
      } catch {
        return Promise.resolve([]);
      }
    },
    save(records: readonly AnnotationRecord[]): Promise<void> {
      try {
        localStorage.setItem(key, JSON.stringify(records));
      } catch {
        // Storage full or unavailable
      }
      return Promise.resolve();
    },
  };
}

/** Persist reading position to localStorage under the given key. */
export function createLocalStoragePositionAdapter(key: string): PositionStorageAdapter {
  return {
    load(): Promise<string | null> {
      try {
        return Promise.resolve(localStorage.getItem(key));
      } catch {
        return Promise.resolve(null);
      }
    },
    save(serialized: string): Promise<void> {
      try {
        localStorage.setItem(key, serialized);
      } catch {
        // Storage full or unavailable
      }
      return Promise.resolve();
    },
    clear(): Promise<void> {
      try {
        localStorage.removeItem(key);
      } catch {
        // Storage full or unavailable
      }
      return Promise.resolve();
    },
  };
}
