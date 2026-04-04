/** Re-export from rito core. */
export type { StorageAdapter } from 'rito/annotations';

export interface PositionStorageAdapter {
  load(): string | null;
  save(serialized: string): void;
  clear(): void;
}
