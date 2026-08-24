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
  handle,
  ManualWorker,
  mutatePageSemantics,
  pageSemantics,
  rawPageSemanticsDocument,
  semanticNode,
} from './versioned-page-semantics-fixtures.mjs';

const { RitoCoreWasmDocument } = createRitoCoreWasmDocumentRuntime(
  async () => {},
  unusedRawDocument,
);

test('direct, in-process, and worker-handler reads return identical page semantics', async () => {
  const calls = [];
  const document = new RitoCoreWasmDocument(rawPageSemanticsDocument(calls));
  const expected = { revision: handle(3), value: pageSemantics() };
  assert.deepEqual(document.getPageSemanticsAtRevision(handle(3), 4), expected);

  const inProcess = createRitoCoreWasmInProcessReaderClient(moduleFor(document));
  await inProcess.open(new ArrayBuffer(0));
  assert.deepEqual(await inProcess.getPageSemanticsAtRevision(handle(3), 4), expected);
  inProcess.dispose();

  const worker = new LoopbackWorker(document);
  const workerClient = createRitoCoreWasmWorkerReaderClient(worker);
  await workerClient.open(new ArrayBuffer(0));
  assert.deepEqual(await workerClient.getPageSemanticsAtRevision(handle(3), 4), expected);
  workerClient.dispose();

  assert.deepEqual(
    calls.filter(([name]) => name === 'getPageSemanticsAtRevisionJson'),
    Array.from({ length: 3 }, () => ['getPageSemanticsAtRevisionJson', ['rev-1', 3, 4]]),
  );
});

test('payload dispatch validates the exact handle and recursive semantic result', () => {
  const payload = versionedReaderWorkerPayload(
    {
      getPageSemanticsAtRevision: () => ({ revision: handle(), value: pageSemantics() }),
    },
    { kind: 'getPageSemanticsAtRevision', revision: handle(), pageIndex: 4 },
  );
  assert.deepEqual(payload, {
    kind: 'getPageSemanticsAtRevision',
    revision: handle(),
    result: pageSemantics(),
  });

  assert.throws(
    () =>
      versionedReaderWorkerPayload(
        {
          getPageSemanticsAtRevision: () => ({
            revision: handle(2),
            value: pageSemantics(),
          }),
        },
        { kind: 'getPageSemanticsAtRevision', revision: handle(), pageIndex: 4 },
      ),
    /mismatched versioned responses/,
  );
  assert.throws(
    () =>
      versionedReaderWorkerPayload(
        {
          getPageSemanticsAtRevision: () => ({
            revision: handle(),
            value: mutatePageSemantics((value) => {
              value.nodes[0].children[0].unknown = true;
            }),
          }),
        },
        { kind: 'getPageSemanticsAtRevision', revision: handle(), pageIndex: 4 },
      ),
    /unknown field unknown/,
  );
});

test('direct reads reject bad ownership and unknown semantic fields', () => {
  assert.throws(
    () => documentReturning(pageSemantics()).getPageSemanticsAtRevision(handle(), -1),
    /pageIndex/,
  );
  const cases = [
    [pageSemantics({ revisionId: 'rev-other' }), /mismatched revisionId/],
    [pageSemantics({ pageIndex: 5 }), /mismatched pageIndex/],
    [pageSemantics({ unknown: true }), /unknown field unknown/],
    [
      mutatePageSemantics((value) => {
        value.nodes[0].bounds.unknown = true;
      }),
      /semantic bounds returned unknown field unknown/,
    ],
  ];
  for (const [value, pattern] of cases) {
    assert.throws(() => documentReturning(value).getPageSemanticsAtRevision(handle(), 4), pattern);
  }
});

test('worker client accepts every role and preserves empty versus missing alt', async () => {
  const worker = new ManualWorker();
  const client = await openManualClient(worker);
  const pending = client.getPageSemanticsAtRevision(handle(), 4);
  worker.respondLast({
    kind: 'getPageSemanticsAtRevision',
    revision: handle(),
    result: pageSemantics(),
  });
  const result = await pending;
  const roles = collectRoles(result.value.nodes);
  assert.deepEqual(
    new Set(roles),
    new Set([
      'heading',
      'paragraph',
      'list',
      'listitem',
      'image',
      'link',
      'blockquote',
      'table',
      'generic',
    ]),
  );
  const images = collectNodes(result.value.nodes).filter((node) => node.role === 'image');
  assert.equal(images[0].alt, '');
  assert.equal(Object.hasOwn(images[1], 'alt'), false);
  client.dispose();
});

test('worker client rejects malformed recursive page semantics', async () => {
  const worker = new ManualWorker();
  const client = await openManualClient(worker);
  const before = worker.messages.length;
  assert.throws(() => client.getPageSemanticsAtRevision(handle(), Number.NaN), /pageIndex/);
  assert.equal(worker.messages.length, before);

  for (const fixture of malformedCases()) {
    const pending = client.getPageSemanticsAtRevision(handle(), 4);
    worker.respondLast({
      kind: 'getPageSemanticsAtRevision',
      revision: fixture.outerRevision ?? handle(),
      result: fixture.value,
    });
    await assert.rejects(pending, fixture.pattern);
  }
  client.dispose();
});

function malformedCases() {
  return [
    invalid(pageSemantics(), /mismatched revision handle/, handle(2)),
    invalid(pageSemantics({ revisionId: 'rev-other' }), /mismatched revisionId/),
    invalid(pageSemantics({ pageIndex: 3 }), /mismatched pageIndex/),
    invalid(pageSemantics({ spreadIndex: -1 }), /spreadIndex/),
    mutated((value) => (value.nodes[0].role = 'listItem'), /invalid semantic role/),
    mutated((value) => (value.nodes[0].bounds.x = Number.NaN), /bounds x/),
    mutated((value) => (value.nodes[0].bounds.width = -1), /bounds width/),
    mutated((value) => delete value.nodes[0].level, /heading level/),
    mutated((value) => (value.nodes[0].level = 7), /heading level/),
    mutated((value) => (value.nodes[1].level = 1), /level on a non-heading/),
    mutated((value) => (value.nodes[1].children[1].href = ''), /without non-empty href/),
    mutated((value) => (value.nodes[1].href = '#wrong'), /href on a non-link/),
    mutated((value) => (value.nodes[1].alt = ''), /alt on a non-image/),
    mutated((value) => (value.nodes[1].children[3].alt = null), /invalid semantic alt/),
    mutated((value) => (value.nodes[1].children = {}), /malformed semantic children/),
    mutated((value) => (value.nodes[1].children[3].text = 'wrong'), /text on an image/),
    mutated(
      (value) => value.nodes[1].children[3].children.push(semanticNode()),
      /children on an image/,
    ),
    mutated(
      (value) => value.nodes[1].children[0].children.push(value.nodes[1]),
      /cyclic semantic children/,
    ),
    mutated((value) => (value.nodes[0].children[0].unknown = true), /unknown field unknown/),
    invalid(pageSemantics({ unknown: true }), /unknown field unknown/),
  ];
}

function mutated(mutate, pattern) {
  return invalid(mutatePageSemantics(mutate), pattern);
}

function invalid(value, pattern, outerRevision) {
  return { value, pattern, outerRevision };
}

function documentReturning(value) {
  return new RitoCoreWasmDocument({
    getPageSemanticsAtRevisionJson: (_revisionId, version) =>
      JSON.stringify({ revision: handle(version), value }),
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

function collectNodes(nodes, output = []) {
  for (const node of nodes) {
    output.push(node);
    collectNodes(node.children, output);
  }
  return output;
}

function collectRoles(nodes) {
  return collectNodes(nodes).map((node) => node.role);
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
