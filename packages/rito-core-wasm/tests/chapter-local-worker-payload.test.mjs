import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmDocumentRuntime } from '../src/core-wasm-document-runtime.js';
import { chapterLocalReaderWorkerPayload } from '../src/reader-worker-chapter-local-payload-runtime.js';
import { createRitoCoreWasmReaderWorkerHandler } from '../src/reader-worker-client-runtime.js';
import { emptyPinnedFontPolicySummary } from './reader-worker-test-fixture.mjs';

const { RitoCoreWasmDocument } = createRitoCoreWasmDocumentRuntime(
  async () => {},
  unusedRawDocument,
);

test('Worker aggregate transfers one full-owned frame buffer and every resource buffer', async () => {
  const exactOwner = owner(0);
  const rawFrame = subview(packedFrameBytes(), 5);
  const rawResource = subview(Uint8Array.of(7, 8, 9), 3);
  const calls = [];
  const document = {
    publication: () => ({ title: 'fixture' }),
    pinnedFontPolicy: emptyPinnedFontPolicySummary,
    free() {},
    readerWorkerPayload(request) {
      calls.push(request.kind);
      return chapterLocalReaderWorkerPayload(this, request);
    },
    createBoundedChapterLocalRevision() {
      calls.push('create');
      return completedAdvance(exactOwner);
    },
    readChapterLocalFrame(ownerValue, localSpreadIndex) {
      calls.push('frame');
      return {
        owner: ownerValue,
        localSpreadIndex,
        metadata: frameMetadata(ownerValue, localSpreadIndex, rawFrame.byteLength),
        bytes: rawFrame,
      };
    },
    prefetchChapterLocalFrameResources(ownerValue, localSpreadIndex) {
      calls.push('resources');
      return {
        owner: ownerValue,
        localSpreadIndex,
        resources: [
          {
            payload: resourcePayload(ownerValue, 'local-transfer-1', rawResource.byteLength),
            bytes: rawResource,
          },
        ],
        missingResources: [],
      };
    },
    releaseChapterLocalRevision(ownerValue) {
      return {
        owner: ownerValue,
        releasedRevision: true,
        releasedTransferCount: 0,
      };
    },
  };
  const scope = new HandlerScope();
  createRitoCoreWasmReaderWorkerHandler(scope, {
    initRitoCoreWasmEngine: async () => ({ openDocument: () => document }),
    normalizeRitoCoreWasmError: normalizeError,
  });
  await scope.send({ id: 1, kind: 'open', data: new ArrayBuffer(0) });

  const response = await scope.send({
    id: 2,
    kind: 'createBoundedChapterLocalRevision',
    request: createRequest(),
  });

  assert.equal(response.ok, true);
  assert.deepEqual(calls, ['createBoundedChapterLocalRevision', 'create', 'frame', 'resources']);
  const frame = response.payload.result.frame;
  assert.equal(frame.bytes.byteOffset, 0);
  assert.equal(frame.bytes.byteLength, frame.bytes.buffer.byteLength);
  assert.equal(frame.resources[0].bytes.byteOffset, 0);
  assert.equal(frame.resources[0].bytes.byteLength, frame.resources[0].bytes.buffer.byteLength);
  assert.notEqual(frame.bytes.buffer, rawFrame.buffer);
  assert.notEqual(frame.resources[0].bytes.buffer, rawResource.buffer);
  assert.deepEqual(scope.transfers.at(-1), [frame.bytes.buffer, frame.resources[0].bytes.buffer]);
  assert.equal(new Set(scope.transfers.at(-1)).size, 2);
});

test('post-commit aggregate failure rolls back the exact candidate owner', () => {
  const exactOwner = owner(0);
  const released = [];
  let freeCount = 0;
  const document = {
    createBoundedChapterLocalRevision: () => completedAdvance(exactOwner),
    readChapterLocalFrame: () => {
      throw new Error('frame failed');
    },
    releaseChapterLocalRevision(ownerValue) {
      released.push(ownerValue);
      return { owner: ownerValue, releasedRevision: true, releasedTransferCount: 3 };
    },
    free() {
      freeCount += 1;
    },
  };

  assert.throws(
    () =>
      chapterLocalReaderWorkerPayload(document, {
        kind: 'createBoundedChapterLocalRevision',
        request: createRequest(),
      }),
    /frame failed/,
  );
  assert.deepEqual(released, [exactOwner]);
  assert.equal(freeCount, 0);
});

test('unconfirmed post-commit aggregate rollback disposes the document owner', () => {
  const exactOwner = owner(0);
  let freeCount = 0;
  const document = {
    createBoundedChapterLocalRevision: () => completedAdvance(exactOwner),
    readChapterLocalFrame: () => {
      throw new Error('frame failed');
    },
    releaseChapterLocalRevision: (ownerValue) => ({
      owner: ownerValue,
      releasedRevision: false,
      releasedTransferCount: 0,
    }),
    free() {
      freeCount += 1;
    },
  };

  assert.throws(() =>
    chapterLocalReaderWorkerPayload(document, {
      kind: 'createBoundedChapterLocalRevision',
      request: createRequest(),
    }),
  );
  assert.equal(freeCount, 1);
});

test('take failure requires release proof for the current and all later local transfers', () => {
  const exactOwner = owner(0);
  const releases = [];
  let freeCount = 0;
  const document = new RitoCoreWasmDocument({
    prefetchChapterLocalFrameResourcesJson: () =>
      JSON.stringify(
        prefetchEnvelope(exactOwner, [
          resourcePayload(exactOwner, 'local-transfer-1', 1),
          resourcePayload(exactOwner, 'local-transfer-2', 1, 'second.png'),
        ]),
      ),
    takeChapterLocalResourceTransfer: () => {
      throw new Error('take failed');
    },
    releaseChapterLocalResourceTransfer: (_ownerJson, transferId) => {
      releases.push(transferId);
      return transferId !== 'local-transfer-1';
    },
    free: () => {
      freeCount += 1;
    },
  });

  assert.throws(() => document.prefetchChapterLocalFrameResources(exactOwner, 0), /take failed/);
  assert.deepEqual(releases, ['local-transfer-1', 'local-transfer-2']);
  assert.equal(freeCount, 1);
});

test('post-take byte validation cleans only still-live later transfers', () => {
  const exactOwner = owner(0);
  const releases = [];
  let freeCount = 0;
  const document = new RitoCoreWasmDocument({
    prefetchChapterLocalFrameResourcesJson: () =>
      JSON.stringify(
        prefetchEnvelope(exactOwner, [
          resourcePayload(exactOwner, 'local-transfer-1', 2),
          resourcePayload(exactOwner, 'local-transfer-2', 1, 'second.png'),
        ]),
      ),
    takeChapterLocalResourceTransfer: () => Uint8Array.of(1),
    releaseChapterLocalResourceTransfer: (_ownerJson, transferId) => {
      releases.push(transferId);
      return true;
    },
    free: () => {
      freeCount += 1;
    },
  });

  assert.throws(
    () => document.prefetchChapterLocalFrameResources(exactOwner, 0),
    /mismatched byteLength/,
  );
  assert.deepEqual(releases, ['local-transfer-2']);
  assert.equal(freeCount, 0);
});

function createRequest() {
  return {
    layoutConfig: { spreadMode: 'single' },
    lineBreaking: 'greedy',
    targetChapterIndex: 3,
    targetLocator: { href: 'chapter.xhtml' },
    localPageCap: 4,
    budget: { maxTopLevelNodes: 1 },
  };
}

function owner(revisionVersion) {
  return {
    revisionId: 'local-1',
    revisionVersion,
    coordinate: { kind: 'chapterLocal', chapterIndex: 3, href: 'chapter.xhtml' },
  };
}

function completedAdvance(exactOwner) {
  const knownExtent = { localPageCount: 1, localSpreadCount: 1 };
  return {
    revision: {
      ...exactOwner,
      layoutKey: 'layout',
      status: 'complete',
      localPageCap: 4,
      knownExtent,
      finalExtent: knownExtent,
      pageCapReached: false,
    },
    previousKnownExtent: { localPageCount: 0, localSpreadCount: 0 },
    newlyKnownLocalPages: { startLocalPage: 0, endLocalPageExclusive: 1 },
    processedTopLevelNodes: 1,
    target: {
      status: 'resolved',
      owner: exactOwner,
      locator: { href: 'chapter.xhtml' },
      spineIdref: 'chapter',
      localPageIndex: 0,
      localSpreadIndex: 0,
      matchedBy: 'href',
    },
  };
}

function frameMetadata(exactOwner, localSpreadIndex, byteLength) {
  return {
    owner: exactOwner,
    localSpreadIndex,
    width: 320,
    height: 480,
    protocolVersion: 2,
    commandCount: 0,
    commandCounts: {},
    recordStats: {
      geometryRecords: 0,
      paintRecords: 0,
      payloadRecords: 0,
      primaryStringRecords: 0,
      secondaryStringRecords: 0,
    },
    byteLength,
    commandHash: 'empty-frame',
    resourceRefCount: 1,
    resourceTable: ['cover.png'],
    fontFamilies: [],
    imageDominated: true,
    stringTable: [],
    payloadTable: [],
  };
}

function packedFrameBytes() {
  const bytes = new Uint8Array(16);
  bytes.set(new TextEncoder().encode('RITOFCB2'));
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 2, true);
  view.setUint32(12, 0, true);
  return bytes;
}

function subview(bytes, prefixLength) {
  const backing = new Uint8Array(prefixLength + bytes.byteLength + 7);
  backing.set(bytes, prefixLength);
  return backing.subarray(prefixLength, prefixLength + bytes.byteLength);
}

function resourcePayload(exactOwner, transferId, byteLength, href = 'cover.png') {
  return {
    owner: exactOwner,
    transferId,
    kind: 'image',
    href,
    mediaType: 'image/png',
    byteLength,
    width: 1,
    height: 1,
  };
}

function prefetchEnvelope(exactOwner, payloads) {
  return {
    owner: exactOwner,
    localSpreadIndex: 0,
    payloads,
    missingResources: [],
    pendingChapterLocalTransferCount: payloads.length,
  };
}

function normalizeError(error) {
  return error instanceof Error ? error : new Error(String(error));
}

function unusedRawDocument() {
  throw new Error('fixture constructs wrapped documents directly');
}

class HandlerScope {
  listener = undefined;
  pending = new Map();
  transfers = [];

  addEventListener(type, listener) {
    assert.equal(type, 'message');
    this.listener = listener;
  }

  postMessage(response, transfer = []) {
    this.transfers.push([...transfer]);
    const resolve = this.pending.get(response.id);
    this.pending.delete(response.id);
    resolve?.(response);
  }

  send(message) {
    const response = new Promise((resolve) => this.pending.set(message.id, resolve));
    this.listener?.({ data: message });
    return response;
  }
}
