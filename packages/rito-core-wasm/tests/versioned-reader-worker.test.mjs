import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmDocumentRuntime } from '../dist/core-wasm-document-runtime.js';
import { RitoCoreWasmError } from '../dist/core-wasm-error-runtime.js';
import {
  createRitoCoreWasmInProcessReaderClient,
  createRitoCoreWasmReaderWorkerHandler,
  createRitoCoreWasmWorkerReaderClient,
} from '../dist/reader-worker-client-runtime.js';

const { RitoCoreWasmDocument } = createRitoCoreWasmDocumentRuntime(
  async () => {},
  unusedRawDocument,
);

test('in-process bounded worker primitives preserve exact revision handles', async () => {
  const { document, calls } = fixtureDocument();
  const client = createRitoCoreWasmInProcessReaderClient(moduleFor(document));
  await client.open(new ArrayBuffer(0));

  const created = await client.createBoundedRevision({ layoutConfig: {}, budget: budget() });
  assert.deepEqual(created.revision, handle(0));
  const continued = await client.continueRevision({
    ...created.revision,
    cursor: created.value.continuation.cursor,
    budget: budget(),
  });
  assert.deepEqual(continued.revision, handle(1));

  const summaryResult = await client.getRevisionSummaryAtRevision(handle(1));
  const shapeDiagnosticResult = await client.getShapeProvenanceDiagnosticAtRevision(handle(1));
  const navigation = await client.getRevisionNavigationAtRevision(handle(1));
  const frame = await client.readFrameBufferAtRevision(handle(1), 0);
  const resource = await client.readResourceAtRevision(handle(1), 'image', 'cover.png');
  const source = await client.resolveSourceLocatorAtRevision(handle(1), {
    href: 'chapter.xhtml',
  });
  const transferRelease = await client.releaseRevisionTransfersAtRevision(handle(1));
  const revisionRelease = await client.releaseRevisionAtRevision(handle(1));

  for (const result of [
    summaryResult,
    shapeDiagnosticResult,
    navigation,
    frame,
    resource,
    source,
    transferRelease,
    revisionRelease,
  ]) {
    assert.deepEqual(result.revision, handle(1));
  }
  assert.deepEqual(frame.value.bytes, Uint8Array.of(4, 5));
  assert.deepEqual(resource.value.bytes, Uint8Array.of(6, 7, 8));
  assert.ok(calls.some(([name, args]) => name === 'releaseRevisionAtRevision' && args[1] === 1));
  client.dispose();
});

test('real worker handler uses the same bounded dispatch and transfers versioned bytes', async () => {
  const { document } = fixtureDocument();
  const scope = new HandlerScope();
  createRitoCoreWasmReaderWorkerHandler(scope, {
    initRitoCoreWasmEngine: async () => ({ openDocument: () => document }),
    normalizeRitoCoreWasmError: normalizeError,
  });
  assert.equal((await scope.send({ id: 1, kind: 'open', data: new ArrayBuffer(0) })).ok, true);
  const created = await scope.send({
    id: 2,
    kind: 'createBoundedRevision',
    request: { layoutConfig: {}, budget: budget() },
  });
  assert.equal(created.ok, true);
  assert.deepEqual(created.payload.revision, handle(0));

  const frame = await scope.send({
    id: 3,
    kind: 'readFrameBufferAtRevision',
    revision: handle(0),
    spreadIndex: 0,
  });
  assert.equal(frame.ok, true);
  assert.deepEqual(frame.payload.revision, handle(0));
  assert.deepEqual(scope.transfers.at(-1), [frame.payload.result.bytes.buffer]);
});

test('worker client rejects cross-version races even when responses arrive out of order', async () => {
  const worker = new ManualWorker();
  const client = createRitoCoreWasmWorkerReaderClient(worker);
  const opening = client.open(new ArrayBuffer(0));
  await Promise.resolve();
  worker.respond(worker.messages[0].id, {
    kind: 'open',
    result: { publication: { title: 'fixture' } },
  });
  await opening;

  const first = client.getRevisionSummaryAtRevision(handle(1));
  const second = client.getRevisionSummaryAtRevision(handle(2));
  const [firstMessage, secondMessage] = worker.messages.slice(-2);
  worker.respond(secondMessage.id, versionedPayload('getRevisionSummaryAtRevision', 2));
  worker.respond(firstMessage.id, versionedPayload('getRevisionSummaryAtRevision', 1));
  assert.deepEqual((await first).revision, handle(1));
  assert.deepEqual((await second).revision, handle(2));

  const raced = client.getRevisionSummaryAtRevision(handle(2));
  worker.respond(worker.messages.at(-1).id, versionedPayload('getRevisionSummaryAtRevision', 3));
  await assert.rejects(raced, /mismatched revision handle/);
  client.dispose();
});

test('failed revision recovery state survives the worker error round trip', async () => {
  const worker = new ManualWorker();
  const client = createRitoCoreWasmWorkerReaderClient(worker);
  const opening = client.open(new ArrayBuffer(0));
  await Promise.resolve();
  worker.respond(worker.messages[0].id, {
    kind: 'open',
    result: { publication: { title: 'fixture' } },
  });
  await opening;

  const continuing = client.continueRevision({
    ...handle(1),
    cursor: 'cursor-2',
    budget: budget(),
  });
  const failedRevision = summary(2, 'failed');
  worker.fail(worker.messages.at(-1).id, {
    name: 'RitoCoreWasmError',
    message: 'layout failed',
    code: 'engine-error',
    revision: failedRevision,
  });

  await assert.rejects(continuing, (error) => {
    assert.ok(error instanceof RitoCoreWasmError);
    assert.equal(error.code, 'engine-error');
    assert.deepEqual(error.revision, failedRevision);
    return true;
  });
  client.dispose();
});

function fixtureDocument() {
  const calls = [];
  const transferId = 'transfer-1';
  const raw = new Proxy(
    {
      publicationJson: () => JSON.stringify({ title: 'fixture' }),
      free() {},
      createBoundedRevisionJson: () => JSON.stringify(advance(0, true)),
      continueRevisionJson: () => JSON.stringify(advance(1, false)),
      getRevisionSummaryAtRevisionJson: (_revisionId, version) =>
        envelope(version, summary(version, 'complete')),
      getShapeProvenanceDiagnosticAtRevisionJson: (_revisionId, version) =>
        envelope(version, shapeDiagnostic()),
      getRevisionNavigationAtRevisionJson: (_revisionId, version) =>
        envelope(version, { revisionId: 'rev-1' }),
      getFrameCommandBufferMetadataAtRevisionJson: (_revisionId, version) =>
        envelope(version, { revisionId: 'rev-1', spreadIndex: 0, byteLength: 2 }),
      readFrameCommandBufferAtRevision: () => Uint8Array.of(4, 5),
      getResourcePayloadAtRevisionJson: (_revisionId, version) =>
        envelope(version, {
          revisionId: 'rev-1',
          transferId,
          kind: 'image',
          href: 'cover.png',
          mediaType: 'image/png',
          byteLength: 3,
        }),
      takeResourceTransfer: () => Uint8Array.of(6, 7, 8),
      releaseResourceTransfer: () => true,
      resolveSourceLocatorAtRevisionJson: (_revisionId, version, locatorJson) =>
        envelope(version, {
          status: 'resolved',
          revisionId: 'rev-1',
          locator: JSON.parse(locatorJson),
          spineIdref: 'chapter',
          pageIndex: 0,
          spreadIndex: 0,
          matchedBy: 'href',
        }),
      releaseRevisionTransfersAtRevision: (_revisionId, version) => envelope(version, 1),
      releaseRevisionAtRevision: (_revisionId, version) =>
        envelope(version, { releasedRevision: true, releasedTransferCount: 0 }),
    },
    {
      get(target, property) {
        const value = target[property];
        if (typeof value !== 'function') return value;
        return (...args) => {
          calls.push([property, args]);
          return value(...args);
        };
      },
    },
  );
  return { calls, document: new RitoCoreWasmDocument(raw) };
}

function moduleFor(document) {
  return { initRitoCoreWasmEngine: async () => ({ openDocument: () => document }) };
}

function shapeDiagnostic() {
  return {
    schemaVersion: 1,
    isComplete: true,
    knownPageCount: 1,
    totalTextRuns: 1,
    exactTextRuns: 0,
    unavailableTextRuns: 1,
    totalTextUtf16CodeUnitCount: 1,
    exactTextUtf16CodeUnitCount: 0,
    unavailableTextUtf16CodeUnitCount: 1,
    excludedRubyTextRunCount: 0,
    excludedRubyTextUtf16CodeUnitCount: 0,
    singleFontTextRuns: 0,
    mixedFontTextRuns: 0,
    unavailableReasonCounts: { hostMetricsFallback: 1 },
    unavailableReasonUtf16CodeUnitCounts: { hostMetricsFallback: 1 },
    singleFontFingerprints: {},
    mixedFontFingerprints: {},
    unavailableAffectedCodepoints: [
      { codepoint: 'U+0041', count: 1, reasonCounts: { hostMetricsFallback: 1 } },
    ],
    unavailableAffectedCodepointOccurrenceCount: 1,
    unavailableAffectedCodepointDistinctCount: 1,
    unavailableAffectedCodepointOmittedCount: 0,
  };
}

function versionedPayload(kind, version) {
  return { kind, revision: handle(version), result: summary(version, 'ready') };
}

function envelope(version, value) {
  return JSON.stringify({ revision: handle(version), value });
}

function advance(version, continuing) {
  return {
    revision: summary(version, continuing ? 'ready' : 'complete'),
    previousKnownExtent: { pageCount: 0, spreadCount: 0 },
    newlyKnownPages: { startPage: 0, endPageExclusive: 1 },
    processedTopLevelNodes: 1,
    ...(continuing ? { continuation: { ...handle(version), cursor: 'cursor-1' } } : {}),
  };
}

function summary(version, status) {
  const knownExtent = { pageCount: 1, spreadCount: 1 };
  return {
    ...handle(version),
    layoutKey: 'layout',
    status,
    knownExtent,
    ...(status === 'complete' ? { finalExtent: knownExtent } : {}),
    pageCount: 1,
    spreadCount: 1,
  };
}

function handle(revisionVersion) {
  return { revisionId: 'rev-1', revisionVersion };
}

function budget() {
  return { maxTopLevelNodes: 1 };
}

function normalizeError(error) {
  return error instanceof Error ? error : new Error(String(error));
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

class ManualWorker {
  listeners = new Map();
  messages = [];

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  postMessage(message) {
    this.messages.push(message);
  }

  terminate() {}

  respond(id, payload) {
    this.emit('message', { data: { id, ok: true, payload } });
  }

  fail(id, error) {
    this.emit('message', { data: { id, ok: false, error } });
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
