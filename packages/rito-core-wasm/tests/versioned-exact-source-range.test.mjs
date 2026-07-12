import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmDocumentRuntime } from '../dist/core-wasm-document-runtime.js';
import {
  createRitoCoreWasmInProcessReaderClient,
  createRitoCoreWasmWorkerReaderClient,
} from '../dist/reader-worker-client-runtime.js';
import { versionedReaderWorkerPayload } from '../dist/reader-worker-versioned-payload-runtime.js';
import { exactRect, handle, ManualWorker } from './versioned-exact-text-interaction-fixtures.mjs';
import { pinnedFontPolicyJson, readerOpenResult } from './reader-worker-test-fixture.mjs';

const { RitoCoreWasmDocument } = createRitoCoreWasmDocumentRuntime(
  async () => {},
  unusedRawDocument,
);

test('direct and in-process exact source reads use the versioned raw method', async () => {
  const calls = [];
  const document = new RitoCoreWasmDocument(rawExactSourceDocument(calls));
  const request = exactSourceRequest();

  assert.deepEqual(document.resolveExactSourceRangeAtRevision(handle(3), request), {
    revision: handle(3),
    value: exactSourceResponse(request),
  });

  const client = createRitoCoreWasmInProcessReaderClient(moduleFor(document));
  await client.open(new ArrayBuffer(0));
  assert.deepEqual(await client.resolveExactSourceRangeAtRevision(handle(3), request), {
    revision: handle(3),
    value: exactSourceResponse(request),
  });
  assert.deepEqual(
    calls.filter(([name]) => name === 'resolveExactSourceRangeAtRevisionJson'),
    [
      ['resolveExactSourceRangeAtRevisionJson', ['rev-1', 3, JSON.stringify(request)]],
      ['resolveExactSourceRangeAtRevisionJson', ['rev-1', 3, JSON.stringify(request)]],
    ],
  );
  client.dispose();
});

test('payload dispatch echoes the normalized exact source request', () => {
  const request = exactSourceRequest({ ignored: true });
  request.sourceRange.start.ignored = true;
  const expected = exactSourceRequest();
  const payload = versionedReaderWorkerPayload(
    {
      resolveExactSourceRangeAtRevision: (_revision, received) => {
        assert.deepEqual(received, expected);
        return { revision: handle(), value: exactSourceResponse(received) };
      },
    },
    { kind: 'resolveExactSourceRangeAtRevision', revision: handle(), request },
  );

  assert.deepEqual(payload, {
    kind: 'resolveExactSourceRangeAtRevision',
    revision: handle(),
    result: exactSourceTransport(expected),
  });
  assert.throws(
    () =>
      versionedReaderWorkerPayload(
        {
          resolveExactSourceRangeAtRevision: () => ({
            revision: handle(2),
            value: exactSourceResponse(expected),
          }),
        },
        { kind: 'resolveExactSourceRangeAtRevision', revision: handle(), request: expected },
      ),
    /mismatched versioned responses/,
  );
});

test('worker validates exact source requests before dispatch and accepts capability states', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const before = worker.messages.length;
  assert.throws(
    () =>
      client.resolveExactSourceRangeAtRevision(
        handle(),
        exactSourceRequest({
          sourceRange: sourceRange({ start: sourcePoint({ textOffset: -1 }) }),
        }),
      ),
    /non-negative safe integers/,
  );
  assert.equal(worker.messages.length, before);

  const pending = client.resolveExactSourceRangeAtRevision(handle(), exactSourceRequest());
  worker.respondLast({
    kind: 'resolveExactSourceRangeAtRevision',
    revision: handle(),
    result: exactSourceTransport(
      exactSourceRequest(),
      exactSourceResponse(exactSourceRequest(), {
        resolution: { status: 'pending', reason: 'notPaginated' },
      }),
    ),
  });
  assert.equal((await pending).value.resolution.status, 'pending');

  const unavailable = client.resolveExactSourceRangeAtRevision(handle(), exactSourceRequest());
  worker.respondLast({
    kind: 'resolveExactSourceRangeAtRevision',
    revision: handle(),
    result: exactSourceTransport(
      exactSourceRequest(),
      exactSourceResponse(exactSourceRequest(), {
        resolution: { status: 'unavailable', reason: 'shapeUnavailable' },
      }),
    ),
  });
  assert.equal((await unavailable).value.resolution.status, 'unavailable');
  client.dispose();
});

test('worker rejects swapped requests and forged exact source geometry', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const request = exactSourceRequest();
  const cases = [
    {
      transport: exactSourceTransport(exactSourceRequest({ href: 'Text/other.xhtml' })),
      pattern: /mismatched href request/,
    },
    mutateRange(
      request,
      (range) => {
        range.sourceLocator.href = 'Text/other.xhtml';
      },
      /projection for a mismatched href/,
    ),
    mutateRange(
      request,
      (range) => {
        range.sourceLocator.sourceRange.end.textOffset = 99;
      },
      /sourceRange does not match/,
    ),
    mutateRange(
      request,
      (range) => {
        range.sourceLocator.progression = 0.5;
      },
      /without one exact source range/,
    ),
    mutateRange(
      request,
      (range) => {
        range.selectedText = '\ud800';
      },
      /malformed UTF-16/,
    ),
    mutateRange(
      request,
      (range) => {
        range.rects = [exactRect({ width: Number.NaN })];
      },
      /width must be non-negative/,
    ),
    mutateRange(
      request,
      (range) => {
        range.rects = [exactRect({ startCharIndex: 4, endCharIndex: 2 })];
      },
      /empty or reversed exact range rect/,
    ),
    mutateRange(
      request,
      (range) => {
        range.rects = [exactRect({ lineIndex: 2 }), exactRect({ lineIndex: 1 })];
      },
      /unordered exact range rects/,
    ),
    {
      transport: exactSourceTransport(
        request,
        exactSourceResponse(request, {
          resolution: { status: 'pending', reason: 'stillLoading' },
        }),
      ),
      pattern: /invalid exact source range pending reason/,
    },
  ];

  for (const fixture of cases) {
    const pending = client.resolveExactSourceRangeAtRevision(handle(), request);
    worker.respondLast({
      kind: 'resolveExactSourceRangeAtRevision',
      revision: handle(),
      result: fixture.transport,
    });
    await assert.rejects(pending, fixture.pattern);
  }
  client.dispose();
});

test('exact source projection rejects content forged onto a collapsed request', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const point = sourcePoint();
  const request = exactSourceRequest({ sourceRange: sourceRange({ start: point, end: point }) });
  const pending = client.resolveExactSourceRangeAtRevision(handle(), request);
  worker.respondLast({
    kind: 'resolveExactSourceRangeAtRevision',
    revision: handle(),
    result: exactSourceTransport(request, exactSourceResponse(request)),
  });
  await assert.rejects(pending, /content for a collapsed exact source range/);
  client.dispose();
});

function mutateRange(request, mutate, pattern) {
  const response = structuredClone(exactSourceResponse(request));
  mutate(response.resolution.range);
  return { transport: exactSourceTransport(request, response), pattern };
}

function exactSourceRequest(overrides = {}) {
  return { href: 'Text/chapter.xhtml', sourceRange: sourceRange(), ...overrides };
}

function sourceRange(overrides = {}) {
  return {
    start: sourcePoint(),
    end: sourcePoint({ nodePath: [2, 0], textOffset: 2 }),
    ...overrides,
  };
}

function sourcePoint(overrides = {}) {
  return { nodePath: [1, 0], textOffset: 3, ...overrides };
}

function exactSourceResponse(request = exactSourceRequest(), overrides = {}) {
  return {
    revisionId: 'rev-1',
    resolution: {
      status: 'resolved',
      range: {
        selectedText: 'i\nTe',
        sourceLocator: { href: request.href, sourceRange: request.sourceRange },
        rects: [
          exactRect(),
          exactRect({
            pageIndex: 5,
            spreadIndex: 3,
            lineIndex: 1,
            startCharIndex: 0,
            endCharIndex: 2,
          }),
        ],
      },
    },
    ...overrides,
  };
}

function exactSourceTransport(
  request = exactSourceRequest(),
  response = exactSourceResponse(request),
) {
  return { request, response };
}

function rawExactSourceDocument(calls) {
  return new Proxy(
    {
      publicationJson: () => JSON.stringify({ title: 'fixture' }),
      pinnedFontPolicyJson,
      free() {},
      resolveExactSourceRangeAtRevisionJson: (_revisionId, version, requestJson) => {
        const request = JSON.parse(requestJson);
        return JSON.stringify({
          revision: handle(version),
          value: exactSourceResponse(request),
        });
      },
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
