import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmDocumentRuntime } from '../dist/core-wasm-document-runtime.js';

const { RitoCoreWasmDocument } = createRitoCoreWasmDocumentRuntime(
  async () => {},
  unusedRawDocument,
);

test('reader resource delivery consumes its transfer without a release call', () => {
  const calls = { read: 0, release: 0, take: 0 };
  const payload = resourcePayload('transfer-1');
  const bytes = Uint8Array.of(1, 2, 3);
  const document = new RitoCoreWasmDocument({
    getResourcePayloadJson: () => JSON.stringify(payload),
    readResourceTransfer: () => {
      calls.read += 1;
      throw new Error('legacy read should not be used');
    },
    releaseResourceTransfer: () => {
      calls.release += 1;
      return true;
    },
    takeResourceTransfer: (transferId) => {
      calls.take += 1;
      assert.equal(transferId, payload.transferId);
      return bytes;
    },
  });

  assert.deepEqual(
    document.readerWorkerPayload({
      id: 1,
      kind: 'readResource',
      revisionId: payload.revisionId,
      resourceKind: payload.kind,
      href: payload.href,
    }),
    { kind: 'readResource', result: { payload, bytes } },
  );
  assert.deepEqual(calls, { read: 0, release: 0, take: 1 });
});

test('frame resource delivery consumes successful transfers and releases only failed takes', () => {
  const first = resourcePayload('transfer-1');
  const missing = resourcePayload('transfer-missing');
  const taken = [];
  const released = [];
  const document = new RitoCoreWasmDocument({
    getFrameCommandBufferMetadataJson: (revisionId, spreadIndex) =>
      JSON.stringify({ revisionId, spreadIndex, byteLength: 2 }),
    prefetchPlannedFrameResourcesJson: () =>
      JSON.stringify({
        plan: {
          revisionId: first.revisionId,
          centerSpreadIndex: 0,
          displaySpreadIndex: 0,
          spreadIndexes: [0],
        },
        spreads: [
          {
            revisionId: first.revisionId,
            spreadIndex: 0,
            payloads: [first, missing],
            missingResources: [],
            pendingTransferCount: 2,
          },
        ],
        pendingTransferCount: 2,
      }),
    readFrameCommandBuffer: () => Uint8Array.of(4, 5),
    readResourceTransfer: () => {
      throw new Error('legacy read should not be used');
    },
    releaseResourceTransfer: (transferId) => {
      released.push(transferId);
      return true;
    },
    takeResourceTransfer: (transferId) => {
      taken.push(transferId);
      if (transferId === missing.transferId) throw new Error('missing transfer');
      return Uint8Array.of(6, 7, 8);
    },
  });

  const response = document.readerWorkerPayload({
    id: 1,
    kind: 'warmFrameWindow',
    revisionId: first.revisionId,
    spreadIndex: 0,
  });

  assert.equal(response.kind, 'warmFrameWindow');
  assert.deepEqual(response.result.spreads[0].resources, [
    { payload: first, bytes: Uint8Array.of(6, 7, 8) },
  ]);
  assert.deepEqual(response.result.spreads[0].missingResources, [
    {
      kind: 'image',
      href: missing.href,
      message: `Frame resource transfer is unavailable: ${missing.href}`,
    },
  ]);
  assert.deepEqual(taken, [first.transferId, missing.transferId]);
  assert.deepEqual(released, [missing.transferId]);
});

function resourcePayload(transferId) {
  return {
    revisionId: 'rev-1',
    transferId,
    kind: 'image',
    href: 'Images/cover.png',
    mediaType: 'image/png',
    byteLength: 3,
    width: 2,
    height: 3,
  };
}

function unusedRawDocument() {
  throw new Error('fixture constructs the wrapped document directly');
}
