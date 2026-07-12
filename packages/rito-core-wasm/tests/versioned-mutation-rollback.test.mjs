import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmDocumentRuntime } from '../src/core-wasm-document-runtime.js';
import { createRitoCoreWasmWorkerReaderClient } from '../src/reader-worker-client-runtime.js';
import { readerOpenResult } from './reader-worker-test-fixture.mjs';

const { RitoCoreWasmDocument } = createRitoCoreWasmDocumentRuntime(
  async () => {},
  unusedRawDocument,
);

test('direct mutation facade rolls back committed malformed revisions by exact handle', () => {
  const cases = [
    {
      expected: handle(0),
      raw: { createBoundedRevisionJson: () => JSON.stringify(forgedAdvance(0)) },
      invoke: (document) => document.createBoundedRevision({ layoutConfig: {}, budget: budget() }),
    },
    {
      expected: handle(2),
      raw: { continueRevisionJson: () => '{malformed' },
      invoke: (document) =>
        document.continueRevision({ ...handle(1), cursor: 'cursor-2', budget: budget() }),
    },
    {
      expected: handle(2),
      raw: { cancelRevisionJson: () => JSON.stringify(summary(2, 'ready')) },
      invoke: (document) => document.cancelRevision(handle(1)),
    },
  ];

  for (const fixture of cases) {
    const released = [];
    const document = new RitoCoreWasmDocument({
      ...fixture.raw,
      releaseRevisionAtRevision: (revisionId, revisionVersion) =>
        released.push({ revisionId, revisionVersion }),
    });
    assert.throws(() => fixture.invoke(document));
    assert.deepEqual(released, [fixture.expected]);
  }
});

test('worker client rolls back only matched malformed mutation responses', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const cases = [
    {
      expected: handle(0),
      start: () => client.createBoundedRevision({ layoutConfig: {}, budget: budget() }),
      kind: 'createBoundedRevision',
      result: forgedAdvance(0),
    },
    {
      expected: handle(2),
      start: () => client.continueRevision({ ...handle(1), cursor: 'cursor-2', budget: budget() }),
      kind: 'continueRevision',
      result: forgedAdvance(2),
    },
    {
      expected: handle(2),
      start: () => client.cancelRevision(handle(1)),
      kind: 'cancelRevision',
      result: summary(2, 'ready'),
    },
  ];

  for (const fixture of cases) {
    const pending = fixture.start();
    const mutationMessageCount = worker.messages.length;
    worker.respondLast({
      kind: fixture.kind,
      revision: fixture.expected,
      result: fixture.result,
    });
    await waitForMessageCount(worker, mutationMessageCount + 1);
    const rollback = worker.messages.at(-1);
    assert.equal(rollback.kind, 'releaseRevisionAtRevision');
    assert.deepEqual(rollback.revision, fixture.expected);
    worker.respond(rollback.id, {
      kind: 'releaseRevisionAtRevision',
      revision: fixture.expected,
      result: { releasedRevision: true, releasedTransferCount: 0 },
    });
    await assert.rejects(pending);
  }
  client.dispose();
});

async function waitForMessageCount(worker, count) {
  for (let attempt = 0; attempt < 10 && worker.messages.length < count; attempt += 1) {
    await Promise.resolve();
  }
  assert.ok(worker.messages.length >= count, 'worker did not request exact rollback');
}

function forgedAdvance(version) {
  return { ...advance(version), processedTopLevelNodes: 2 };
}

function advance(version) {
  const revision = summary(version, 'ready');
  return {
    revision,
    previousKnownExtent: { pageCount: 0, spreadCount: 0 },
    newlyKnownPages: { startPage: 0, endPageExclusive: 1 },
    processedTopLevelNodes: 1,
    continuation: { ...handle(version), cursor: `cursor-${String(version + 1)}` },
  };
}

function summary(version, status) {
  const knownExtent = { pageCount: 1, spreadCount: 1 };
  return {
    ...handle(version),
    layoutKey: 'layout',
    status,
    knownExtent,
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

async function openClient(worker) {
  const client = createRitoCoreWasmWorkerReaderClient(worker);
  const opening = client.open(new ArrayBuffer(0));
  await Promise.resolve();
  worker.respondLast({ kind: 'open', result: readerOpenResult({ title: 'fixture' }) });
  await opening;
  return client;
}

function unusedRawDocument() {
  throw new Error('fixture constructs the wrapped document directly');
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

  respondLast(payload) {
    this.respond(this.messages.at(-1).id, payload);
  }

  respond(id, payload) {
    this.emit('message', { data: { id, ok: true, payload } });
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
