import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmDocumentRuntime } from '../dist/core-wasm-document-runtime.js';
import {
  createRitoCoreWasmInProcessReaderClient,
  createRitoCoreWasmReaderWorkerHandler,
} from '../dist/reader-worker-client-runtime.js';
import { versionedReaderWorkerPayload } from '../dist/reader-worker-versioned-payload-runtime.js';
import {
  caretAddress,
  caretResponse,
  caretTransport,
  handle,
  pointRequest,
  pointRangeRequest,
  pointRangeResponse,
  pointRangeTransport,
  rangeRequest,
  rangeResponse,
  rangeTransport,
  rawExactTextDocument,
} from './versioned-exact-text-interaction-fixtures.mjs';

const { RitoCoreWasmDocument } = createRitoCoreWasmDocumentRuntime(
  async () => {},
  unusedRawDocument,
);

test('in-process exact text reads use versioned raw methods and unwrap request-bound transports', async () => {
  const calls = [];
  const document = new RitoCoreWasmDocument(rawExactTextDocument(calls));
  const client = createRitoCoreWasmInProcessReaderClient(moduleFor(document));
  await client.open(new ArrayBuffer(0));

  const point = pointRequest();
  const caret = await client.resolveTextCaretAtRevision(handle(3), point);
  const rangeInput = rangeRequest();
  const range = await client.resolveTextRangeAtRevision(handle(3), rangeInput);
  const granularInput = pointRangeRequest();
  const granular = await client.resolveTextRangeFromPointsAtRevision(handle(3), granularInput);

  assert.deepEqual(caret, { revision: handle(3), value: caretResponse() });
  assert.deepEqual(range, { revision: handle(3), value: rangeResponse(rangeInput) });
  assert.equal(range.value.resolution.range.selectedText, 'i\n\nTe');
  assert.notDeepEqual(
    range.value.resolution.range.sourceLocator.sourceRange.start.nodePath,
    range.value.resolution.range.sourceLocator.sourceRange.end.nodePath,
  );
  assert.equal(range.value.resolution.range.rects.length, 2);
  assert.deepEqual(granular, {
    revision: handle(3),
    value: pointRangeResponse(granularInput),
  });
  assert.deepEqual(
    calls.filter(([name]) => name.includes('AtRevision')),
    [
      ['resolveTextCaretAtRevisionJson', ['rev-1', 3, JSON.stringify(point)]],
      ['resolveTextRangeAtRevisionJson', ['rev-1', 3, JSON.stringify(rangeInput)]],
      ['resolveTextRangeFromPointsAtRevisionJson', ['rev-1', 3, JSON.stringify(granularInput)]],
    ],
  );
  client.dispose();
});

test('payload dispatch echoes normalized exact requests and validates both envelopes', () => {
  const point = pointRequest();
  const caret = versionedReaderWorkerPayload(
    { resolveTextCaretAtRevision: () => ({ revision: handle(), value: caretResponse() }) },
    { kind: 'resolveTextCaretAtRevision', revision: handle(), request: point },
  );
  assert.deepEqual(caret, {
    kind: 'resolveTextCaretAtRevision',
    revision: handle(),
    result: caretTransport(point),
  });

  const rangeInput = rangeRequest();
  const range = versionedReaderWorkerPayload(
    {
      resolveTextRangeAtRevision: () => ({
        revision: handle(),
        value: rangeResponse(rangeInput),
      }),
    },
    { kind: 'resolveTextRangeAtRevision', revision: handle(), request: rangeInput },
  );
  assert.deepEqual(range, {
    kind: 'resolveTextRangeAtRevision',
    revision: handle(),
    result: rangeTransport(rangeInput),
  });

  const granularInput = pointRangeRequest({ granularity: 'paragraph' });
  const granular = versionedReaderWorkerPayload(
    {
      resolveTextRangeFromPointsAtRevision: () => ({
        revision: handle(),
        value: pointRangeResponse(granularInput),
      }),
    },
    {
      kind: 'resolveTextRangeFromPointsAtRevision',
      revision: handle(),
      request: granularInput,
    },
  );
  assert.deepEqual(granular, {
    kind: 'resolveTextRangeFromPointsAtRevision',
    revision: handle(),
    result: pointRangeTransport(granularInput),
  });

  assert.throws(
    () =>
      versionedReaderWorkerPayload(
        { resolveTextCaretAtRevision: () => ({ revision: handle(2), value: caretResponse() }) },
        { kind: 'resolveTextCaretAtRevision', revision: handle(), request: point },
      ),
    /mismatched versioned responses/,
  );
  assert.throws(
    () =>
      versionedReaderWorkerPayload(
        { resolveTextCaretAtRevision: () => assert.fail('must not dispatch') },
        {
          kind: 'resolveTextCaretAtRevision',
          revision: handle(),
          request: pointRequest({ x: Number.NaN }),
        },
      ),
    /x must be finite/,
  );
});

test('direct exact range rejects content forged onto a collapsed caret', () => {
  const document = new RitoCoreWasmDocument(rawExactTextDocument([]));
  const endpoint = caretAddress();

  assert.throws(
    () =>
      document.resolveTextRangeAtRevision(handle(), {
        anchor: endpoint,
        focus: endpoint,
      }),
    /content for a collapsed exact range/,
  );
});

test('direct granular point range rejects forged durable source endpoints', () => {
  const request = pointRangeRequest();
  const response = structuredClone(pointRangeResponse(request));
  response.resolution.range.sourceLocator.sourceRange.start.textOffset = 0;
  const raw = rawExactTextDocument([]);
  raw.resolveTextRangeFromPointsAtRevisionJson = () =>
    JSON.stringify({ revision: handle(), value: response });
  const document = new RitoCoreWasmDocument(raw);

  assert.throws(
    () => document.resolveTextRangeFromPointsAtRevision(handle(), request),
    /source endpoints unrelated/,
  );
});

test('real worker handler dispatches granular point ranges through the validated payload path', async () => {
  const document = new RitoCoreWasmDocument(rawExactTextDocument([]));
  const scope = new HandlerScope();
  createRitoCoreWasmReaderWorkerHandler(scope, {
    initRitoCoreWasmEngine: async () => ({ openDocument: () => document }),
    normalizeRitoCoreWasmError: (error) =>
      error instanceof Error ? error : new Error(String(error)),
  });
  assert.equal((await scope.send({ id: 1, kind: 'open', data: new ArrayBuffer(0) })).ok, true);
  const request = pointRangeRequest({ granularity: 'paragraph' });
  const response = await scope.send({
    id: 2,
    kind: 'resolveTextRangeFromPointsAtRevision',
    revision: handle(),
    request,
  });

  assert.deepEqual(response, {
    id: 2,
    ok: true,
    payload: {
      kind: 'resolveTextRangeFromPointsAtRevision',
      revision: handle(),
      result: pointRangeTransport(request),
    },
  });
});

function moduleFor(document) {
  return { initRitoCoreWasmEngine: async () => ({ openDocument: () => document }) };
}

function unusedRawDocument() {
  throw new Error('fixture constructs the wrapped document directly');
}

class HandlerScope {
  pending = new Map();

  addEventListener(_type, listener) {
    this.listener = listener;
  }

  postMessage(message) {
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
