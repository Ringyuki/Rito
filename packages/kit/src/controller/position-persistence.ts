import type { PositionStorageAdapter } from '../storage/types';

export interface PositionPersistence {
  /** Writes are serialized so an older slow save can never finish after a newer one. */
  save(serialized: string): Promise<void>;
  /** True only while the storage adapter's save callback is executing. */
  hasActiveWrite(): boolean;
}

export function createPositionPersistence(
  storage: PositionStorageAdapter | undefined,
): PositionPersistence {
  let tail = Promise.resolve();
  let activeWrites = 0;
  return {
    save(serialized) {
      const write = tail.then(async () => {
        if (!storage) return;
        activeWrites += 1;
        try {
          await storage.save(serialized);
        } finally {
          activeWrites -= 1;
        }
      });
      tail = write.then(ignoreResult, ignoreResult);
      return write;
    },
    hasActiveWrite: () => activeWrites > 0,
  };
}

function ignoreResult(): void {}
