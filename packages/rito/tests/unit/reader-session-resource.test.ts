// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createInMemoryReaderResourceTransferStore } from '../../src/runtime/reader-session';
import type { StoreReaderResourceTransferInput } from '../../src/runtime/reader-session/resource';
import {
  BASE_REQUEST,
  frameFromInput,
  makePage,
  makeResourceDocument,
  paginationResult,
  resource,
  testSession,
} from './reader-session-test-utils';

describe('createReaderSession resource lifecycle', () => {
  it('prefetches frame image resource transfers for later resource reads', async () => {
    const store = createInMemoryReaderResourceTransferStore();
    const image = resource('image', 'Images/cover.png', 'image/png');
    const session = testSession({
      document: makeResourceDocument({
        images: new Map([['Images/cover.png', new Uint8Array([1, 2, 3])]]),
      }),
      paginateRevision: () => paginationResult([makePage(0)]),
      buildFrame(input) {
        return {
          ...frameFromInput(input),
          resourceRefs: [image],
        };
      },
      storeResourceTransfer: (input) => store.storeTransfer(input),
    });
    const revision = await session.createRevision(BASE_REQUEST);

    const spreadIndexes = await session.prefetch({
      revisionId: revision.id,
      spreadIndexes: [0],
    });
    const payload = await session.getResource({
      revisionId: revision.id,
      resource: image,
    });

    expect(spreadIndexes).toEqual([0]);
    expect(payload).toMatchObject({
      transferId: 'transfer-1',
      byteLength: 3,
      mediaType: 'image/png',
    });
    expect(store.getTransferCount()).toBe(1);
    expect(store.readTransfer('transfer-1')).toMatchObject({
      sessionId: 'session-1',
      revisionId: revision.id,
      resource: { href: 'Images/cover.png' },
      bytes: new Uint8Array([1, 2, 3]),
    });
  });

  it('keeps prefetch resource warming best effort when image bytes are unavailable', async () => {
    const warnings: unknown[][] = [];
    const store = createInMemoryReaderResourceTransferStore();
    const session = testSession({
      document: makeResourceDocument(),
      paginateRevision: () => paginationResult([makePage(0)]),
      buildFrame(input) {
        return {
          ...frameFromInput(input),
          resourceRefs: [resource('image', 'Images/missing.png', 'image/png')],
        };
      },
      storeResourceTransfer: (input) => store.storeTransfer(input),
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn: (...args) => {
          warnings.push(args);
        },
        error: () => undefined,
      },
    });
    const revision = await session.createRevision(BASE_REQUEST);

    await expect(
      session.prefetch({ revisionId: revision.id, spreadIndexes: [0] }),
    ).resolves.toEqual([0]);

    expect(store.getTransferCount()).toBe(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.[0]).toBe('Reader resource prefetch failed');
  });

  it('returns resource payloads through the transfer side channel', async () => {
    const imageBytes = new Uint8Array([1, 2, 3]);
    const fontBytes = new Uint8Array([4, 5]);
    const transfers: StoreReaderResourceTransferInput[] = [];
    const session = testSession({
      document: makeResourceDocument({
        images: new Map([['Images/cover.png', imageBytes]]),
        fonts: new Map([['Fonts/book.otf', fontBytes]]),
        stylesheets: new Map([['Styles/book.css', 'body { color: black; }']]),
      }),
      paginateRevision: () => paginationResult([makePage(0)]),
      storeResourceTransfer(input) {
        transfers.push(input);
        return `transfer-${String(transfers.length)}`;
      },
    });
    const revision = await session.createRevision(BASE_REQUEST);

    const image = await session.getResource({
      revisionId: revision.id,
      resource: resource('image', 'Images/cover.png', 'image/png'),
    });
    const font = await session.getResource({
      revisionId: revision.id,
      resource: resource('font', 'Fonts/book.otf', 'font/otf'),
    });
    const stylesheet = await session.getResource({
      revisionId: revision.id,
      resource: resource('stylesheet', 'Styles/book.css'),
    });

    expect(image).toMatchObject({
      byteLength: 3,
      transferId: 'transfer-1',
      mediaType: 'image/png',
    });
    expect(font).toMatchObject({
      byteLength: 2,
      transferId: 'transfer-2',
      mediaType: 'font/otf',
    });
    expect(stylesheet).toMatchObject({
      byteLength: new TextEncoder().encode('body { color: black; }').byteLength,
      transferId: 'transfer-3',
      mediaType: 'text/css',
    });
    expect('bytes' in image).toBe(false);
    expect('bytes' in font).toBe(false);
    expect('bytes' in stylesheet).toBe(false);
    expect(transfers[0]).toMatchObject({
      sessionId: 'session-1',
      revisionId: revision.id,
      bytes: imageBytes,
      mediaType: 'image/png',
    });
    expect(transfers[1]).toMatchObject({
      sessionId: 'session-1',
      revisionId: revision.id,
      bytes: fontBytes,
      mediaType: 'font/otf',
    });
    expect(Array.from(transfers[2]?.bytes ?? [])).toEqual(
      Array.from(new TextEncoder().encode('body { color: black; }')),
    );
  });

  it('keeps shared resource transfers readable until all duplicate payloads release', async () => {
    const store = createInMemoryReaderResourceTransferStore();
    const image = resource('image', 'Images/cover.png', 'image/png');
    const session = testSession({
      document: makeResourceDocument({
        images: new Map([['Images/cover.png', new Uint8Array([1, 2, 3])]]),
      }),
      paginateRevision: () => paginationResult([makePage(0)]),
      storeResourceTransfer: (input) => store.storeTransfer(input),
    });
    const revision = await session.createRevision(BASE_REQUEST);

    const first = await session.getResource({ revisionId: revision.id, resource: image });
    const second = await session.getResource({ revisionId: revision.id, resource: image });

    expect(second.transferId).toBe(first.transferId);
    expect(store.releaseTransfer(first.transferId)).toBe(true);
    expect(store.readTransfer(second.transferId)).toMatchObject({
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(store.releaseTransfer(second.transferId)).toBe(true);
    expect(store.readTransfer(second.transferId)).toBeUndefined();
  });

  it('releases transfer side-channel records when revisions cancel or sessions dispose', async () => {
    const releases: Array<{ readonly sessionId: string; readonly revisionId?: string }> = [];
    const session = testSession({
      paginateRevision: () => paginationResult([makePage(0)]),
      releaseResourceTransfers(input) {
        releases.push(input);
      },
    });

    const first = await session.createRevision(BASE_REQUEST);
    const second = await session.createRevision(BASE_REQUEST);
    session.cancelRevision(first.id);
    session.dispose();

    expect(releases).toEqual([
      { sessionId: 'session-1', revisionId: first.id },
      { sessionId: 'session-1' },
    ]);
    expect(second.status).toBe('ready');
  });

  it('rejects unavailable, mismatched, and unsupported resources', async () => {
    const session = testSession({
      document: makeResourceDocument({
        fonts: new Map([['Fonts/book.otf', new Uint8Array([1])]]),
      }),
      paginateRevision: () => paginationResult([makePage(0)]),
    });
    const revision = await session.createRevision(BASE_REQUEST);

    await expect(
      session.getResource({
        revisionId: revision.id,
        resource: resource('image', 'Images/missing.png', 'image/png'),
      }),
    ).rejects.toMatchObject({
      protocolError: { code: 'resource-unavailable' },
    });
    await expect(
      session.getResource({
        revisionId: revision.id,
        resource: resource('image', 'Fonts/book.otf', 'font/otf'),
      }),
    ).rejects.toMatchObject({
      protocolError: { code: 'resource-unavailable' },
    });
    await expect(
      session.getResource({
        revisionId: revision.id,
        resource: resource('publication', 'book.epub', 'application/epub+zip'),
      }),
    ).rejects.toMatchObject({
      protocolError: { code: 'not-supported' },
    });
  });

  it('fails resource fetches when no transfer store is configured', async () => {
    const session = testSession({
      document: makeResourceDocument({
        images: new Map([['Images/cover.png', new Uint8Array([1, 2, 3])]]),
      }),
      paginateRevision: () => paginationResult([makePage(0)]),
    });
    const revision = await session.createRevision(BASE_REQUEST);

    await expect(
      session.getResource({
        revisionId: revision.id,
        resource: resource('image', 'Images/cover.png', 'image/png'),
      }),
    ).rejects.toMatchObject({
      protocolError: {
        code: 'internal-error',
        message: 'Reader resource transfer store is not configured',
      },
    });
  });
});
