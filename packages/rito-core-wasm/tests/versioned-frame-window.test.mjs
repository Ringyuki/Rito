import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmDocumentRuntime } from '../dist/core-wasm-document-runtime.js';
import { normalizeRitoCoreWasmError } from '../dist/core-wasm-error-runtime.js';
import {
  createRitoCoreWasmInProcessReaderClient,
  createRitoCoreWasmReaderWorkerHandler,
} from '../dist/reader-worker-client-runtime.js';
import { pinnedFontPolicyJson } from './reader-worker-test-fixture.mjs';

const { RitoCoreWasmDocument } = createRitoCoreWasmDocumentRuntime(
  async () => {},
  unusedRawDocument,
);

test('versioned frame-window preserves terminal missing and failed-transfer resources', async () => {
  const fixture = frameWindowFixture({
    missingTransferId: 'transfer-2',
    missingResources: [missingResource('image-3.png', 'resource is absent')],
  });
  const client = createRitoCoreWasmInProcessReaderClient(moduleFor(fixture.document));
  await client.open(new ArrayBuffer(0));

  const warmed = await client.warmFrameWindowAtRevision(handle(), 0);

  assert.deepEqual(warmed.revision, handle());
  assert.deepEqual(
    warmed.value.frames.map((frame) => [...frame.bytes]),
    [[10], [11]],
  );
  assert.deepEqual(
    warmed.value.spreads.flatMap((spread) =>
      spread.resources.map((resource) => resource.payload.href),
    ),
    ['image-1.png'],
  );
  assert.deepEqual(warmed.value.spreads[0].missingResources, [
    missingResource('image-3.png', 'resource is absent'),
    missingResource('image-2.png', 'Frame resource transfer is unavailable: image-2.png'),
  ]);
  assert.deepEqual(warmed.value.spreads[1].missingResources, []);
  assert.deepEqual(fixture.released, ['transfer-2']);
  client.dispose();
});

test('versioned frame-window rejects stale or mismatched handles and releases planned leases', () => {
  const stale = frameWindowFixture({ stalePrefetch: true });
  assert.throws(
    () => stale.document.warmFrameWindowAtRevision(handle(), 0),
    (error) => error.code === 'stale-revision-version',
  );

  const mismatched = frameWindowFixture({ metadataVersion: 4 });
  assert.throws(
    () => mismatched.document.warmFrameWindowAtRevision(handle(), 0),
    /mismatched revision handle/,
  );
  assert.deepEqual(mismatched.released.sort(), ['transfer-1', 'transfer-2']);

  for (const options of [{ metadataRevisionId: 'rev-other' }, { metadataSpreadIndex: 99 }]) {
    const innerMismatch = frameWindowFixture(options);
    assert.throws(
      () => innerMismatch.document.warmFrameWindowAtRevision(handle(), 0),
      /mismatched (revisionId|spreadIndex)/,
    );
    assert.deepEqual(innerMismatch.released.sort(), ['transfer-1', 'transfer-2']);
  }
});

test('versioned frame-window rejects forged plan indexes and releases planned leases', () => {
  for (const options of [
    { planCenterSpreadIndex: 1 },
    { planDisplaySpreadIndex: 1 },
    { planSpreadIndexes: [0, 0] },
    { planSpreadIndexes: [0, 1.5] },
    { resourceSpreadIndex: 99 },
  ]) {
    const fixture = frameWindowFixture(options);
    assert.throws(
      () => fixture.document.warmFrameWindowAtRevision(handle(), 0),
      /(mismatched spreadIndex|invalid frame window spread indexes)/,
    );
    assert.deepEqual(fixture.released.sort(), ['transfer-1', 'transfer-2']);
  }
});

test('versioned frame-window rejects conflicting terminal resource results', () => {
  const fixture = frameWindowFixture({
    missingResources: [missingResource('image-1.png', 'conflicts with payload')],
  });

  assert.throws(
    () => fixture.document.warmFrameWindowAtRevision(handle(), 0),
    /conflicting frame window resource results/,
  );
  assert.deepEqual(fixture.released.sort(), ['transfer-1', 'transfer-2']);
});

test('real worker transfers every versioned frame-window buffer', async () => {
  const fixture = frameWindowFixture();
  const scope = new HandlerScope();
  createRitoCoreWasmReaderWorkerHandler(scope, {
    initRitoCoreWasmEngine: async () => ({ openDocument: () => fixture.document }),
    normalizeRitoCoreWasmError,
  });
  await scope.send({ id: 1, kind: 'open', data: new ArrayBuffer(0) });

  const response = await scope.send({
    id: 2,
    kind: 'warmFrameWindowAtRevision',
    revision: handle(),
    spreadIndex: 0,
  });

  assert.equal(response.ok, true);
  assert.deepEqual(response.payload.revision, handle());
  const result = response.payload.result;
  const expected = [
    ...result.frames.map((frame) => frame.bytes.buffer),
    ...result.spreads.flatMap((spread) =>
      spread.resources.map((resource) => resource.bytes.buffer),
    ),
  ];
  assert.deepEqual(new Set(scope.transfers.at(-1)), new Set(expected));
});

function frameWindowFixture(options = {}) {
  const released = [];
  const resources = [resource('transfer-1', 'image-1.png'), resource('transfer-2', 'image-2.png')];
  const raw = {
    publicationJson: () => JSON.stringify({ title: 'fixture' }),
    pinnedFontPolicyJson,
    free() {},
    prefetchPlannedFrameResourcesAtRevisionJson: (_revisionId, revisionVersion) => {
      if (options.stalePrefetch) {
        throw new Error(
          JSON.stringify({
            code: 'stale-revision-version',
            message: 'stale revision version',
          }),
        );
      }
      const spreadIndexes = options.planSpreadIndexes ?? [0, 1];
      return envelope(revisionVersion, {
        plan: {
          revisionId: 'rev-1',
          centerSpreadIndex: options.planCenterSpreadIndex ?? 0,
          displaySpreadIndex: options.planDisplaySpreadIndex ?? 0,
          spreadIndexes,
        },
        spreads: spreadIndexes.map((spreadIndex, index) =>
          index === 0
            ? {
                revisionId: 'rev-1',
                spreadIndex: options.resourceSpreadIndex ?? spreadIndex,
                payloads: resources,
                missingResources: options.missingResources ?? [],
                pendingTransferCount: resources.length,
              }
            : {
                revisionId: 'rev-1',
                spreadIndex,
                payloads: [],
                missingResources: [],
                pendingTransferCount: resources.length,
              },
        ),
        pendingTransferCount: resources.length,
      });
    },
    getFrameCommandBufferMetadataAtRevisionJson: (_revisionId, revisionVersion, spreadIndex) =>
      envelope(options.metadataVersion ?? revisionVersion, {
        revisionId: options.metadataRevisionId ?? 'rev-1',
        spreadIndex: options.metadataSpreadIndex ?? spreadIndex,
        byteLength: 1,
      }),
    readFrameCommandBufferAtRevision: (_revisionId, _revisionVersion, spreadIndex) =>
      Uint8Array.of(10 + spreadIndex),
    takeResourceTransfer: (transferId) => {
      if (transferId === options.missingTransferId) throw new Error('missing transfer');
      return Uint8Array.of(transferId === 'transfer-1' ? 20 : 21);
    },
    releaseResourceTransfer: (transferId) => {
      released.push(transferId);
      return true;
    },
  };
  return { document: new RitoCoreWasmDocument(raw), released };
}

function moduleFor(document) {
  return { initRitoCoreWasmEngine: async () => ({ openDocument: () => document }) };
}

function resource(transferId, href) {
  return {
    revisionId: 'rev-1',
    transferId,
    kind: 'image',
    href,
    mediaType: 'image/png',
    byteLength: 1,
  };
}

function missingResource(href, message) {
  return { kind: 'image', href, message };
}

function envelope(revisionVersion, value) {
  return JSON.stringify({ revision: handle(revisionVersion), value });
}

function handle(revisionVersion = 3) {
  return { revisionId: 'rev-1', revisionVersion };
}

function unusedRawDocument() {
  throw new Error('fixture constructs the wrapped document directly');
}

class HandlerScope {
  pending = new Map();
  transfers = [];

  addEventListener(_type, listener) {
    this.listener = listener;
  }

  postMessage(message, transfer = []) {
    this.transfers.push(transfer);
    this.pending.get(message.id)?.(message);
    this.pending.delete(message.id);
  }

  send(message) {
    return new Promise((resolve) => {
      this.pending.set(message.id, resolve);
      this.listener({ data: message });
    });
  }
}
