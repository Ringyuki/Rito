import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmDocumentRuntime } from '../dist/core-wasm-document-runtime.js';
import {
  createRitoCoreWasmInProcessReaderClient,
  createRitoCoreWasmWorkerReaderClient,
} from '../dist/reader-worker-client-runtime.js';
import {
  crossLineOffsetsWithoutLf,
  geometryDiagnostic,
  handle,
  invalidGapOffsets,
  ManualWorker,
  pageTextPositions,
  rangeRect,
  rangeRequest,
  rawTextGeometryDocument,
  sameLineOffsetsWithLf,
  textRangeGeometry,
} from './versioned-text-geometry-fixtures.mjs';

const { RitoCoreWasmDocument } = createRitoCoreWasmDocumentRuntime(
  async () => {},
  unusedRawDocument,
);

test('in-process reader binds diagnostic geometry to its normalized request', async () => {
  const calls = [];
  const document = new RitoCoreWasmDocument(rawTextGeometryDocument(calls));
  const client = createRitoCoreWasmInProcessReaderClient(moduleFor(document));
  await client.open(new ArrayBuffer(0));

  const positions = await client.getPageTextPositionsAtRevision(handle(3), 4);
  const reversed = rangeRequest({
    start: rangeRequest().end,
    end: rangeRequest().start,
  });
  const geometry = await client.getTextRangeGeometryAtRevision(handle(3), reversed);

  assert.deepEqual(positions, { revision: handle(3), value: pageTextPositions() });
  assert.deepEqual(geometry, {
    revision: handle(3),
    value: geometryDiagnostic(),
  });
  assert.deepEqual(
    calls.filter(([name]) => name.includes('AtRevision')).map(([name, args]) => [name, args]),
    [
      ['getPageTextPositionsAtRevisionJson', ['rev-1', 3, 4]],
      ['getTextRangeGeometryAtRevisionJson', ['rev-1', 3, JSON.stringify(rangeRequest())]],
    ],
  );
  client.dispose();
});

test('worker client rejects forged diagnostic payloads behind matching handles', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const cases = forgedWorkerCases(client);

  for (const fixture of cases) {
    const pending = fixture.pending();
    worker.respondLast({ kind: fixture.kind, revision: handle(1), result: fixture.result });
    await assert.rejects(pending, fixture.pattern);
  }
  client.dispose();
});

test('worker client rejects malformed text diagnostic input before dispatch', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const messageCount = worker.messages.length;

  assert.throws(() => client.getPageTextPositionsAtRevision(handle(1), -1), /pageIndex/);
  assert.throws(
    () =>
      client.getTextRangeGeometryAtRevision(handle(1), {
        ...rangeRequest(),
        end: { blockIndex: 0, lineIndex: 1, runIndex: 0, charIndex: Number.NaN },
      }),
    /charIndex/,
  );
  assert.equal(worker.messages.length, messageCount);
  client.dispose();
});

function forgedWorkerCases(client) {
  return [
    positionsCase(client, pageTextPositions({ revisionId: 'rev-other' }), /mismatched revisionId/),
    positionsCase(client, pageTextPositions({ textHash: 'not-a-hash' }), /invalid textHash/),
    positionsCase(client, pageTextPositions({ offsets: invalidGapOffsets() }), /cross-line LF/),
    positionsCase(
      client,
      pageTextPositions({
        text: 'Helloworld',
        textLength: 10,
        offsets: crossLineOffsetsWithoutLf(),
      }),
      /cross-line LF/,
    ),
    positionsCase(
      client,
      pageTextPositions({ offsets: sameLineOffsetsWithLf() }),
      /same-line text offset/,
    ),
    geometryCase(
      client,
      geometryDiagnostic({ request: rangeRequest({ pageIndex: 3 }) }),
      /mismatched normalized request/,
    ),
    geometryCase(
      client,
      geometryDiagnostic({ geometry: textRangeGeometry({ rects: [] }) }),
      /empty range geometry/,
    ),
    geometryCase(
      client,
      geometryDiagnostic({
        geometry: textRangeGeometry({ rects: [rangeRect(0, 1, 0, 0, 3)] }),
      }),
      /cover both endpoints/,
    ),
    geometryCase(
      client,
      geometryDiagnostic({ geometry: textRangeGeometry({ spreadIndex: -1 }) }),
      /spreadIndex/,
    ),
    geometryCase(
      client,
      geometryDiagnostic({ geometry: textRangeGeometry({ rects: [rangeRect(0, 1, 0, 0, 4)] }) }),
      /outside the requested text range/,
    ),
    geometryCase(
      client,
      geometryDiagnostic({
        geometry: textRangeGeometry({
          rects: [rangeRect(0, 1, 0, 0, 3), rangeRect(0, 0, 0, 1, 5)],
        }),
      }),
      /unordered rects/,
    ),
    geometryCase(
      client,
      geometryDiagnostic({
        geometry: textRangeGeometry({
          rects: [{ ...rangeRect(0, 0, 0, 1, 5), width: -1 }, rangeRect(0, 1, 0, 0, 3)],
        }),
      }),
      /invalid range rect width/,
    ),
  ];
}

function positionsCase(client, result, pattern) {
  return {
    pending: () => client.getPageTextPositionsAtRevision(handle(1), 4),
    kind: 'getPageTextPositionsAtRevision',
    result,
    pattern,
  };
}

function geometryCase(client, result, pattern) {
  return {
    pending: () => client.getTextRangeGeometryAtRevision(handle(1), rangeRequest()),
    kind: 'getTextRangeGeometryAtRevision',
    result,
    pattern,
  };
}

async function openClient(worker) {
  const client = createRitoCoreWasmWorkerReaderClient(worker);
  const opening = client.open(new ArrayBuffer(0));
  await Promise.resolve();
  worker.respondLast({ kind: 'open', result: { publication: { title: 'fixture' } } });
  await opening;
  return client;
}

function moduleFor(document) {
  return { initRitoCoreWasmEngine: async () => ({ openDocument: () => document }) };
}

function unusedRawDocument() {
  throw new Error('fixture constructs the wrapped document directly');
}
