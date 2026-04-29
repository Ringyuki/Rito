import { describe, expect, it } from 'vitest';
import {
  createInMemoryReaderResourceTransferStore,
  type ReaderResourceRef,
} from '../../src/runtime/reader-session';
import type { StoreReaderResourceTransferInput } from '../../src/runtime/reader-session/resource';

function resource(href = 'Images/cover.png'): ReaderResourceRef {
  return {
    id: `image:${href}`,
    kind: 'image',
    href,
    mediaType: 'image/png',
  };
}

function transferInput(
  href: string,
  bytes: Uint8Array,
  revisionId = 'rev-1',
): StoreReaderResourceTransferInput {
  return {
    sessionId: 'session-1',
    revisionId,
    resource: resource(href),
    bytes,
    mediaType: 'image/png',
  };
}

describe('createInMemoryReaderResourceTransferStore', () => {
  it('stores transfer bytes behind generated ids', () => {
    const store = createInMemoryReaderResourceTransferStore();

    const first = store.storeTransfer({
      sessionId: 'session-1',
      revisionId: 'rev-1',
      resource: resource('Images/cover.png'),
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: 'image/png',
    });
    const second = store.storeTransfer({
      sessionId: 'session-1',
      revisionId: 'rev-2',
      resource: resource('Images/back.png'),
      bytes: new Uint8Array([4]),
      mediaType: 'image/png',
    });

    expect(first).toBe('transfer-1');
    expect(second).toBe('transfer-2');
    expect(store.getTransferCount()).toBe(2);
    expect(store.getTransferByteLength()).toBe(4);
    expect(store.readTransfer(first)).toMatchObject({
      transferId: first,
      sessionId: 'session-1',
      revisionId: 'rev-1',
      resource: { href: 'Images/cover.png' },
      byteLength: 3,
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: 'image/png',
    });
  });

  it('copies bytes on store and read to avoid mutable cache aliasing', () => {
    const store = createInMemoryReaderResourceTransferStore();
    const original = new Uint8Array([1, 2, 3]);
    const transferId = store.storeTransfer({
      sessionId: 'session-1',
      revisionId: 'rev-1',
      resource: resource(),
      bytes: original,
      mediaType: 'image/png',
    });

    original[0] = 9;
    const firstRead = store.readTransfer(transferId);
    if (!firstRead) throw new Error('Expected stored transfer');
    firstRead.bytes[1] = 8;
    const secondRead = store.readTransfer(transferId);

    expect(firstRead.bytes).toEqual(new Uint8Array([1, 8, 3]));
    expect(secondRead?.bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('supports custom transfer ids and rejects collisions', () => {
    const store = createInMemoryReaderResourceTransferStore({
      createTransferId: (input, sequence) => `${input.resource.id}:${String(sequence)}`,
    });

    expect(
      store.storeTransfer({
        sessionId: 'session-1',
        revisionId: 'rev-1',
        resource: resource('Images/cover.png'),
        bytes: new Uint8Array([1]),
      }),
    ).toBe('image:Images/cover.png:1');

    const colliding = createInMemoryReaderResourceTransferStore({
      createTransferId: () => 'same-id',
    });
    colliding.storeTransfer(transferInput('Images/one.png', new Uint8Array([1])));

    expect(() => {
      colliding.storeTransfer(transferInput('Images/two.png', new Uint8Array([2])));
    }).toThrow('Reader resource transfer same-id already exists');
  });

  it('releases and clears transfer records', () => {
    const store = createInMemoryReaderResourceTransferStore();
    const first = store.storeTransfer(transferInput('Images/one.png', new Uint8Array([1])));
    const second = store.storeTransfer(transferInput('Images/two.png', new Uint8Array([2])));

    expect(store.releaseTransfer(first)).toBe(true);
    expect(store.releaseTransfer(first)).toBe(false);
    expect(store.getTransferByteLength()).toBe(1);
    expect(store.readTransfer(first)).toBeUndefined();
    expect(store.readTransfer(second)).toBeDefined();

    store.clearTransfers();

    expect(store.getTransferCount()).toBe(0);
    expect(store.getTransferByteLength()).toBe(0);
    expect(store.readTransfer(second)).toBeUndefined();
  });

  it('reuses live transfers for the same revision resource identity with lease counts', () => {
    const store = createInMemoryReaderResourceTransferStore();
    const first = store.storeTransfer(transferInput('Images/cover.png', new Uint8Array([1, 2])));
    const duplicate = store.storeTransfer(
      transferInput('Images/cover.png', new Uint8Array([1, 2])),
    );
    const otherRevision = store.storeTransfer(
      transferInput('Images/cover.png', new Uint8Array([1, 2]), 'rev-2'),
    );

    expect(duplicate).toBe(first);
    expect(otherRevision).toBe('transfer-2');
    expect(store.getTransferCount()).toBe(2);

    expect(store.releaseTransfer(first)).toBe(true);
    expect(store.readTransfer(first)).toMatchObject({
      bytes: new Uint8Array([1, 2]),
    });
    expect(store.releaseTransfer(first)).toBe(true);
    expect(store.readTransfer(first)).toBeUndefined();
    expect(store.storeTransfer(transferInput('Images/cover.png', new Uint8Array([1, 2])))).toBe(
      'transfer-3',
    );
  });

  it('releases transfers by revision or by session scope', () => {
    const store = createInMemoryReaderResourceTransferStore();
    const first = store.storeTransfer(
      transferInput('Images/one.png', new Uint8Array([1]), 'rev-1'),
    );
    const second = store.storeTransfer(
      transferInput('Images/two.png', new Uint8Array([2]), 'rev-2'),
    );
    const third = store.storeTransfer({
      ...transferInput('Images/three.png', new Uint8Array([3]), 'rev-1'),
      sessionId: 'session-2',
    });

    expect(store.releaseTransfers({ sessionId: 'session-1', revisionId: 'rev-1' })).toBe(1);
    expect(store.getTransferByteLength()).toBe(2);
    expect(store.readTransfer(first)).toBeUndefined();
    expect(store.readTransfer(second)).toBeDefined();
    expect(store.readTransfer(third)).toBeDefined();

    expect(store.releaseTransfers({ sessionId: 'session-1' })).toBe(1);
    expect(store.getTransferByteLength()).toBe(1);
    expect(store.readTransfer(second)).toBeUndefined();
    expect(store.readTransfer(third)).toBeDefined();
  });

  it('rejects new transfers when active transfer count budget is exhausted', () => {
    const store = createInMemoryReaderResourceTransferStore({ maxTransfers: 2 });
    const first = store.storeTransfer(transferInput('Images/one.png', new Uint8Array([1])));
    const second = store.storeTransfer(transferInput('Images/two.png', new Uint8Array([2])));

    expect(store.readTransfer(first)).toBeDefined();
    expect(() => {
      store.storeTransfer(transferInput('Images/three.png', new Uint8Array([3])));
    }).toThrow('Reader resource transfer transfer-3 would exceed maxTransfers');

    expect(store.getTransferCount()).toBe(2);
    expect(store.getTransferByteLength()).toBe(2);
    expect(store.readTransfer(first)).toBeDefined();
    expect(store.readTransfer(second)).toBeDefined();

    expect(store.releaseTransfer(second)).toBe(true);
    expect(store.storeTransfer(transferInput('Images/three.png', new Uint8Array([3])))).toBe(
      'transfer-4',
    );
  });

  it('rejects new transfers when active transfer byte budget is exhausted', () => {
    const store = createInMemoryReaderResourceTransferStore({ maxTransferBytes: 5 });
    const first = store.storeTransfer(transferInput('Images/one.png', new Uint8Array([1, 2])));
    const second = store.storeTransfer(transferInput('Images/two.png', new Uint8Array([3, 4])));

    expect(store.readTransfer(first)).toBeDefined();
    expect(() => {
      store.storeTransfer(transferInput('Images/three.png', new Uint8Array([5, 6])));
    }).toThrow('Reader resource transfer transfer-3 would exceed maxTransferBytes');

    expect(store.getTransferCount()).toBe(2);
    expect(store.getTransferByteLength()).toBe(4);
    expect(store.readTransfer(first)).toBeDefined();
    expect(store.readTransfer(second)).toBeDefined();

    expect(store.releaseTransfer(second)).toBe(true);
    expect(store.storeTransfer(transferInput('Images/three.png', new Uint8Array([5, 6])))).toBe(
      'transfer-4',
    );
  });

  it('fails oversized transfers instead of returning unbacked transfer ids', () => {
    const store = createInMemoryReaderResourceTransferStore({ maxTransferBytes: 2 });

    expect(() => {
      store.storeTransfer(transferInput('Images/large.png', new Uint8Array([1, 2, 3])));
    }).toThrow('Reader resource transfer transfer-1 exceeds maxTransferBytes');
    expect(store.getTransferCount()).toBe(0);
    expect(store.getTransferByteLength()).toBe(0);
  });

  it('rejects non-positive transfer cache sizes', () => {
    expect(() => createInMemoryReaderResourceTransferStore({ maxTransfers: 0 })).toThrow(
      'Reader resource transfer maxTransfers must be a positive integer',
    );
    expect(() => createInMemoryReaderResourceTransferStore({ maxTransfers: 1.5 })).toThrow(
      'Reader resource transfer maxTransfers must be a positive integer',
    );
    expect(() => createInMemoryReaderResourceTransferStore({ maxTransferBytes: 0 })).toThrow(
      'Reader resource transfer maxTransferBytes must be a positive integer',
    );
    expect(() => createInMemoryReaderResourceTransferStore({ maxTransferBytes: 1.5 })).toThrow(
      'Reader resource transfer maxTransferBytes must be a positive integer',
    );
  });
});
