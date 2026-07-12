import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmDocumentRuntime } from '../dist/core-wasm-document-runtime.js';
import {
  createRitoCoreWasmInProcessReaderClient,
  createRitoCoreWasmReaderWorkerHandler,
  createRitoCoreWasmWorkerReaderClient,
} from '../dist/reader-worker-client-runtime.js';
import { versionedReaderWorkerPayload } from '../dist/reader-worker-versioned-payload-runtime.js';
import { readerOpenResult } from './reader-worker-test-fixture.mjs';
import {
  anchorHandle,
  mutatePageReadingAnchor,
  pageReadingAnchor,
  rawPageReadingAnchorDocument,
  unavailablePageReadingAnchor,
} from './versioned-page-reading-anchor-fixtures.mjs';
import { ManualWorker } from './versioned-page-semantics-fixtures.mjs';

const { RitoCoreWasmDocument } = createRitoCoreWasmDocumentRuntime(
  async () => {},
  unusedRawDocument,
);

test('direct, in-process, and worker reads return the same portable page anchor', async () => {
  const calls = [];
  const document = new RitoCoreWasmDocument(rawPageReadingAnchorDocument(calls));
  const expected = { revision: anchorHandle(3), value: pageReadingAnchor() };
  assert.deepEqual(document.getPageReadingAnchorAtRevision(anchorHandle(3), 4), expected);

  const inProcess = createRitoCoreWasmInProcessReaderClient(moduleFor(document));
  await inProcess.open(new ArrayBuffer(0));
  assert.deepEqual(await inProcess.getPageReadingAnchorAtRevision(anchorHandle(3), 4), expected);
  inProcess.dispose();

  const workerClient = createRitoCoreWasmWorkerReaderClient(new LoopbackWorker(document));
  await workerClient.open(new ArrayBuffer(0));
  assert.deepEqual(await workerClient.getPageReadingAnchorAtRevision(anchorHandle(3), 4), expected);
  workerClient.dispose();

  assert.deepEqual(
    calls.filter(([name]) => name === 'getPageReadingAnchorAtRevisionJson'),
    Array.from({ length: 3 }, () => ['getPageReadingAnchorAtRevisionJson', ['rev-1', 3, 4]]),
  );
});

test('payload dispatch validates exact ownership and both capability states', () => {
  for (const value of [pageReadingAnchor(), unavailablePageReadingAnchor('sourceUnavailable')]) {
    const payload = versionedReaderWorkerPayload(
      {
        getPageReadingAnchorAtRevision: () => ({ revision: anchorHandle(), value }),
      },
      { kind: 'getPageReadingAnchorAtRevision', revision: anchorHandle(), pageIndex: 4 },
    );
    assert.deepEqual(payload, {
      kind: 'getPageReadingAnchorAtRevision',
      revision: anchorHandle(),
      result: value,
    });
  }

  assert.throws(
    () =>
      versionedReaderWorkerPayload(
        {
          getPageReadingAnchorAtRevision: () => ({
            revision: anchorHandle(2),
            value: pageReadingAnchor(),
          }),
        },
        { kind: 'getPageReadingAnchorAtRevision', revision: anchorHandle(), pageIndex: 4 },
      ),
    /mismatched versioned responses/,
  );
});

test('direct reads reject forged reading-anchor fields and source identity', () => {
  assert.throws(
    () => documentReturning(pageReadingAnchor()).getPageReadingAnchorAtRevision(anchorHandle(), -1),
    /pageIndex/,
  );
  for (const fixture of malformedAnchors()) {
    assert.throws(
      () =>
        documentReturning(fixture.value, fixture.outerRevision).getPageReadingAnchorAtRevision(
          anchorHandle(),
          4,
        ),
      fixture.pattern,
    );
  }
});

test('worker client correlates out-of-order page anchor responses by request id', async () => {
  const worker = new ManualWorker();
  const client = await openManualClient(worker);
  const first = client.getPageReadingAnchorAtRevision(anchorHandle(), 4);
  const firstMessage = worker.messages.at(-1);
  const second = client.getPageReadingAnchorAtRevision(anchorHandle(2), 7);
  const secondMessage = worker.messages.at(-1);

  respond(worker, secondMessage, {
    kind: 'getPageReadingAnchorAtRevision',
    revision: anchorHandle(2),
    result: unavailablePageReadingAnchor('noSourceContent', { pageIndex: 7 }),
  });
  assert.equal((await second).value.pageIndex, 7);
  respond(worker, firstMessage, {
    kind: 'getPageReadingAnchorAtRevision',
    revision: anchorHandle(),
    result: pageReadingAnchor(),
  });
  assert.equal((await first).value.locator.sourcePoint.textOffset, 8);
  client.dispose();
});

test('worker rejects malformed responses and bad requests before dispatch', async () => {
  const worker = new ManualWorker();
  const client = await openManualClient(worker);
  const before = worker.messages.length;
  assert.throws(
    () => client.getPageReadingAnchorAtRevision(anchorHandle(), Number.NaN),
    /pageIndex/,
  );
  assert.equal(worker.messages.length, before);
  await assert.rejects(
    client.createViewRevision({
      mode: 'preview',
      layoutConfig: { pageWidth: 320, pageHeight: 480 },
      activeSpreadIndex: 0,
      preserveLocator: {
        ...pageReadingAnchor().locator,
        unknown: true,
      },
    }),
    /source locator returned unknown field unknown/,
  );
  assert.equal(worker.messages.length, before);

  for (const fixture of malformedAnchors()) {
    const pending = client.getPageReadingAnchorAtRevision(anchorHandle(), 4);
    worker.respondLast({
      kind: 'getPageReadingAnchorAtRevision',
      revision: fixture.outerRevision ?? anchorHandle(),
      result: fixture.value,
    });
    await assert.rejects(pending, fixture.pattern);
  }
  client.dispose();
});

function malformedAnchors() {
  return [
    invalid(pageReadingAnchor(), /mismatched revision handle/, anchorHandle(2)),
    invalid(pageReadingAnchor({ revisionId: 'rev-other' }), /mismatched revisionId/),
    invalid(pageReadingAnchor({ pageIndex: 3 }), /mismatched pageIndex/),
    invalid(pageReadingAnchor({ spreadIndex: -1 }), /spreadIndex/),
    invalid(pageReadingAnchor({ status: 'pending' }), /invalid page reading anchor status/),
    invalid(pageReadingAnchor({ unknown: true }), /unknown field unknown/),
    invalid(unavailablePageReadingAnchor('stillLoading'), /invalid page reading anchor reason/),
    invalid(
      unavailablePageReadingAnchor('noSourceContent', { locator: {} }),
      /unknown field locator/,
    ),
    mutated((value) => (value.reason = 'noSourceContent'), /unknown field reason/),
    mutated((value) => (value.locator.href = ''), /invalid source locator href/),
    mutated((value) => delete value.locator.sourcePoint, /without an exact source point/),
    mutated((value) => (value.locator.progression = 2), /progression/),
    mutated((value) => (value.locator.unknown = true), /unknown field unknown/),
    mutated((value) => (value.locator.sourcePoint.textOffset = -1), /source text offset/),
    mutated((value) => (value.locator.sourcePoint.unknown = true), /unknown field unknown/),
    mutated((value) => {
      value.locator.sourceRange = {
        start: value.locator.sourcePoint,
        end: value.locator.sourcePoint,
      };
    }, /reading anchor with a source range/),
  ];
}

function mutated(mutate, pattern) {
  return invalid(mutatePageReadingAnchor(mutate), pattern);
}

function invalid(value, pattern, outerRevision) {
  return { value, pattern, outerRevision };
}

function documentReturning(value, outerRevision) {
  return new RitoCoreWasmDocument({
    getPageReadingAnchorAtRevisionJson: (_revisionId, version) =>
      JSON.stringify({ revision: outerRevision ?? anchorHandle(version), value }),
  });
}

function moduleFor(document) {
  return { initRitoCoreWasmEngine: async () => ({ openDocument: () => document }) };
}

async function openManualClient(worker) {
  const client = createRitoCoreWasmWorkerReaderClient(worker);
  const opening = client.open(new ArrayBuffer(0));
  await Promise.resolve();
  worker.respondLast({ kind: 'open', result: readerOpenResult({ title: 'fixture' }) });
  await opening;
  return client;
}

function respond(worker, message, payload) {
  for (const listener of worker.listeners.get('message') ?? []) {
    listener({ data: { id: message.id, ok: true, payload } });
  }
}

function unusedRawDocument() {
  throw new Error('fixture constructs the wrapped document directly');
}

class LoopbackWorker {
  listeners = new Map();

  constructor(document) {
    const scope = {
      addEventListener: (_type, listener) => (this.handler = listener),
      postMessage: (message) => this.emit('message', { data: message }),
    };
    createRitoCoreWasmReaderWorkerHandler(scope, {
      initRitoCoreWasmEngine: async () => ({ openDocument: () => document }),
      normalizeRitoCoreWasmError: (error) =>
        error instanceof Error ? error : new Error(String(error)),
    });
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  postMessage(message) {
    queueMicrotask(() => this.handler({ data: message }));
  }

  terminate() {}

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
