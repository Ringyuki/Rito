import type { PositionStorageAdapter } from '../storage/types';

export interface PositionPersistence {
  /** Writes are serialized so an older slow save can never finish after a newer one. */
  save(serialized: string): Promise<void>;
}

export function createPositionPersistence(
  storage: PositionStorageAdapter | undefined,
): PositionPersistence {
  let tail = Promise.resolve();
  return {
    save(serialized) {
      const write = tail.then(() => storage?.save(serialized));
      tail = write.then(ignoreResult, ignoreResult);
      return write;
    },
  };
}

function ignoreResult(): void {}
