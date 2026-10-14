import {
  createLocalStorageAnnotationAdapter,
  createLocalStoragePositionAdapter,
  type PositionStorageAdapter,
  type RecordStorageAdapter,
} from '@ritojs/kit';

/**
 * Reading position and annotations stored per book: the adapters read and
 * write under the key of whichever book is open, so two books never share
 * a position or each other's highlights. Set the book before loading it.
 */
export function createBookStorage(): {
  readonly setBook: (key: string) => void;
  readonly positionStorage: PositionStorageAdapter;
  readonly annotationStorage: RecordStorageAdapter;
} {
  let book = 'none';
  const position = () => createLocalStoragePositionAdapter(`rito-position:${book}`);
  const annotations = () => createLocalStorageAnnotationAdapter(`rito-annotations:${book}`);
  return {
    setBook: (key) => {
      book = key;
    },
    positionStorage: {
      load: () => position().load(),
      save: (serialized) => position().save(serialized),
      clear: () => position().clear(),
    },
    annotationStorage: {
      load: () => annotations().load(),
      save: (records) => annotations().save(records),
    },
  };
}

/** A stable key for a book's bytes: the start of their SHA-256. */
export async function bookKey(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest).slice(0, 8), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
