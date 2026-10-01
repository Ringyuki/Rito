import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmDocumentRuntime } from '../dist/core-wasm-document-runtime.js';
import {
  createRitoCoreWasmInProcessReaderClient,
  createRitoCoreWasmWorkerReaderClient,
} from '../dist/reader-worker-client-runtime.js';
import { versionedReaderWorkerPayload } from '../dist/reader-worker-versioned-payload-runtime.js';
import { handle, ManualWorker } from './versioned-exact-text-interaction-fixtures.mjs';
import { pinnedFontPolicyJson, readerOpenResult } from './reader-worker-test-fixture.mjs';

const { RitoCoreWasmDocument } = createRitoCoreWasmDocumentRuntime(
  async () => {},
  unusedRawDocument,
);

// The engine's canonical bytes for one target (pinned by the Rust suite).
const CANONICAL_TARGET =
  '{"version":1,"href":"chapter.xhtml","sourceRange":{"start":{"nodePath":[0,1,0],"textOffset":0},"end":{"nodePath":[0,1,0],"textOffset":4}},"quote":{"exact":"beta","prefix":"Alpha ","suffix":" gamma"},"position":{"start":6,"end":10,"chapterLength":16}}';

test('a parsed canonical target serializes back to the same bytes', () => {
  assert.equal(JSON.stringify(JSON.parse(CANONICAL_TARGET)), CANONICAL_TARGET);
});

test('direct and in-process annotation calls use the versioned raw methods', async () => {
  const calls = [];
  const document = new RitoCoreWasmDocument(rawAnnotationDocument(calls));
  const request = targetRequest();
  const target = JSON.parse(CANONICAL_TARGET);

  assert.deepEqual(document.createAnnotationTargetAtRevision(handle(3), request), {
    revision: handle(3),
    value: target,
  });
  assert.deepEqual(document.resolveAnnotationTargetAtRevision(handle(3), target), {
    revision: handle(3),
    value: { level: 'exact', target },
  });

  const client = createRitoCoreWasmInProcessReaderClient(moduleFor(document));
  await client.open(new ArrayBuffer(0));
  assert.deepEqual(await client.resolveAnnotationTargetAtRevision(handle(3), target), {
    revision: handle(3),
    value: { level: 'exact', target },
  });
  assert.deepEqual(
    calls.filter(([name]) => name === 'resolveAnnotationTargetAtRevisionJson'),
    [
      ['resolveAnnotationTargetAtRevisionJson', ['rev-1', 3, CANONICAL_TARGET]],
      ['resolveAnnotationTargetAtRevisionJson', ['rev-1', 3, CANONICAL_TARGET]],
    ],
  );
  client.dispose();
});

test('targets are rebuilt in the engine field order and other shapes are rejected', () => {
  const document = new RitoCoreWasmDocument(rawAnnotationDocument([]));
  const reordered = JSON.parse(CANONICAL_TARGET);
  const shuffled = {
    position: reordered.position,
    quote: reordered.quote,
    sourceRange: reordered.sourceRange,
    href: reordered.href,
    version: 1,
  };
  const resolved = document.resolveAnnotationTargetAtRevision(handle(), shuffled);
  assert.equal(JSON.stringify(resolved.value.target), CANONICAL_TARGET);

  const cases = [
    [{ ...reordered, version: 2 }, /version must be 1/],
    [{ ...reordered, extra: true }, /unknown field extra/],
    [{ ...reordered, quote: { exact: 'beta', prefix: '' } }, /missing suffix/],
    [{ ...reordered, position: { ...reordered.position, start: -1 } }, /non-negative/],
  ];
  for (const [value, pattern] of cases) {
    assert.throws(() => document.resolveAnnotationTargetAtRevision(handle(), value), pattern);
  }
});

test('payload dispatch echoes the normalized request and target', () => {
  const target = JSON.parse(CANONICAL_TARGET);
  const created = versionedReaderWorkerPayload(
    { createAnnotationTargetAtRevision: () => ({ revision: handle(), value: target }) },
    { kind: 'createAnnotationTargetAtRevision', revision: handle(), request: targetRequest() },
  );
  assert.deepEqual(created, {
    kind: 'createAnnotationTargetAtRevision',
    revision: handle(),
    result: { request: targetRequest(), response: target },
  });

  const orphaned = versionedReaderWorkerPayload(
    {
      resolveAnnotationTargetAtRevision: () => ({
        revision: handle(),
        value: { level: 'orphaned', reason: 'hrefNotFound' },
      }),
    },
    { kind: 'resolveAnnotationTargetAtRevision', revision: handle(), target },
  );
  assert.deepEqual(orphaned.result, {
    target,
    response: { level: 'orphaned', reason: 'hrefNotFound' },
  });
});

test('the worker client rejects forged annotation results', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const target = JSON.parse(CANONICAL_TARGET);
  const cases = [
    [{ request: targetRequest({ href: 'other.xhtml' }), response: target }, /mismatched request/],
    [
      {
        request: targetRequest(),
        response: { ...target, position: { ...target.position, end: 6 } },
      },
      /empty annotation target/,
    ],
  ];
  for (const [result, pattern] of cases) {
    const pending = client.createAnnotationTargetAtRevision(handle(), targetRequest());
    worker.respondLast({ kind: 'createAnnotationTargetAtRevision', revision: handle(), result });
    await assert.rejects(pending, pattern);
  }

  const forged = client.resolveAnnotationTargetAtRevision(handle(), target);
  worker.respondLast({
    kind: 'resolveAnnotationTargetAtRevision',
    revision: handle(),
    result: { target, response: { level: 'fuzzy', target } },
  });
  await assert.rejects(forged, /invalid annotation resolution level/);
  client.dispose();
});

function targetRequest(overrides = {}) {
  return {
    href: 'chapter.xhtml',
    sourceRange: {
      start: { nodePath: [0, 1, 0], textOffset: 0 },
      end: { nodePath: [0, 1, 0], textOffset: 4 },
    },
    ...overrides,
  };
}

function rawAnnotationDocument(calls) {
  return new Proxy(
    {
      publicationJson: () => JSON.stringify({ title: 'fixture' }),
      pinnedFontPolicyJson,
      free() {},
      createAnnotationTargetAtRevisionJson: (_revisionId, version) =>
        `{"revision":${JSON.stringify(handle(version))},"value":${CANONICAL_TARGET}}`,
      resolveAnnotationTargetAtRevisionJson: (_revisionId, version, targetJson) =>
        `{"revision":${JSON.stringify(handle(version))},"value":{"level":"exact","target":${targetJson}}}`,
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
}

async function openClient(worker) {
  const client = createRitoCoreWasmWorkerReaderClient(worker);
  const opening = client.open(new ArrayBuffer(0));
  await Promise.resolve();
  worker.respondLast({ kind: 'open', result: readerOpenResult({ title: 'fixture' }) });
  await opening;
  return client;
}

function moduleFor(document) {
  return { initRitoCoreWasmEngine: async () => ({ openDocument: () => document }) };
}

function unusedRawDocument() {
  throw new Error('fixture constructs the wrapped document directly');
}
