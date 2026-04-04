import type { Annotation, StorageAdapter } from 'rito/annotations';
import type { PositionStorageAdapter } from './types';

export function createLocalStorageAdapter(key: string): StorageAdapter {
  return {
    load(): Promise<readonly Annotation[]> {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return Promise.resolve([]);
        return Promise.resolve(JSON.parse(raw) as Annotation[]);
      } catch {
        return Promise.resolve([]);
      }
    },
    save(annotations: readonly Annotation[]): Promise<void> {
      try {
        localStorage.setItem(key, JSON.stringify(annotations));
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
