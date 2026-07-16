import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmDocumentRuntime } from '../dist/core-wasm-document-runtime.js';
import { createRitoCoreWasmInProcessReaderClient } from '../dist/reader-worker-client-runtime.js';
import { versionedReaderWorkerPayload } from '../dist/reader-worker-versioned-payload-runtime.js';
import {
  caretAddress,
  caretResponse,
  caretTransport,
  handle,
  pointRequest,
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

  assert.deepEqual(caret, { revision: handle(3), value: caretResponse() });
  assert.deepEqual(range, { revision: handle(3), value: rangeResponse(rangeInput) });
  assert.equal(range.value.resolution.range.selectedText, 'i\n\nTe');
  assert.notDeepEqual(
    range.value.resolution.range.sourceLocator.sourceRange.start.nodePath,
    range.value.resolution.range.sourceLocator.sourceRange.end.nodePath,
  );
  assert.equal(range.value.resolution.range.rects.length, 2);
  assert.deepEqual(
    calls.filter(([name]) => name.includes('AtRevision')),
    [
      ['resolveTextCaretAtRevisionJson', ['rev-1', 3, JSON.stringify(point)]],
      ['resolveTextRangeAtRevisionJson', ['rev-1', 3, JSON.stringify(rangeInput)]],
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

function moduleFor(document) {
  return { initRitoCoreWasmEngine: async () => ({ openDocument: () => document }) };
}

function unusedRawDocument() {
  throw new Error('fixture constructs the wrapped document directly');
}
