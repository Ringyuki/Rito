import type { AnnotationRecord, RecordStorageAdapter } from 'rito/annotations';
import type { PositionStorageAdapter } from './types';

/** Storage adapter that persists AnnotationRecords to localStorage. */
export function createLocalStorageAdapter(key: string): RecordStorageAdapter {
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
        // Storage full or unavailable — silently fail
      }
      return Promise.resolve();
    },
  };
}

export function createLocalStoragePositionAdapter(key: string): PositionStorageAdapter {
  return {
    load(): string | null {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    save(serialized: string): void {
      try {
        localStorage.setItem(key, serialized);
      } catch {
        // Storage full or unavailable
      }
    },
    clear(): void {
      try {
        localStorage.removeItem(key);
      } catch {
        // Ignore
      }
    },
  };
}
