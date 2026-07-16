import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmWorkerReaderClient } from '../dist/reader-worker-client-runtime.js';
import { readerOpenResult } from './reader-worker-test-fixture.mjs';
import {
  caretAddress,
  caretResponse,
  caretTransport,
  exactRect,
  handle,
  ManualWorker,
  pointRequest,
  rangeRequest,
  rangeResponse,
  rangeTransport,
  resolvedCaret,
} from './versioned-exact-text-interaction-fixtures.mjs';

test('worker client rejects malformed exact requests before dispatch', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const count = worker.messages.length;

  assert.throws(
    () =>
      client.resolveTextCaretAtRevision(handle(), pointRequest({ y: Number.POSITIVE_INFINITY })),
    /y must be finite/,
  );
  assert.throws(
    () =>
      client.resolveTextRangeAtRevision(
        handle(),
        rangeRequest({ focus: caretAddress({ affinity: 'middle' }) }),
      ),
    /affinity/,
  );
  assert.equal(worker.messages.length, count);
  client.dispose();
});

test('worker client rejects swapped or forged exact caret responses', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const cases = [
    caretCase(
      caretTransport(pointRequest({ x: 99 }), caretResponse()),
      /mismatched normalized request/,
    ),
    caretCase(
      caretTransport(pointRequest(), caretResponse({ revisionId: 'rev-other' })),
      /revisionId/,
    ),
    caretCase(caretTransport(pointRequest(), caretResponse({ pageIndex: 5 })), /pageIndex/),
    caretCase(
      caretTransport(
        pointRequest(),
        caretResponse({
          resolution: resolvedCaret({ address: caretAddress({ pageIndex: 5 }) }),
        }),
      ),
      /caret for a mismatched pageIndex/,
    ),
    caretCase(
      caretTransport(
        pointRequest(),
        caretResponse({ resolution: resolvedCaret({ geometry: { x: 1, y: 2, height: 0 } }) }),
      ),
      /height must be positive/,
    ),
    caretCase(
      caretTransport(
        pointRequest(),
        caretResponse({
          resolution: resolvedCaret({
            sourceLocator: { href: 'Text/chapter.xhtml', anchorId: 'forged' },
          }),
        }),
      ),
      /exact source point/,
    ),
    caretCase(
      caretTransport(
        pointRequest(),
        caretResponse({ resolution: { status: 'unavailable', reason: 'approximate' } }),
      ),
      /invalid text interaction unavailable reason/,
    ),
    caretCase(
      caretTransport(
        pointRequest(),
        caretResponse({
          resolution: { status: 'unavailable', reason: 'differentChapter' },
        }),
      ),
      /range-only unavailable reason/,
    ),
  ];

  for (const fixture of cases) {
    const pending = client.resolveTextCaretAtRevision(handle(), pointRequest());
    worker.respondLast({
      kind: 'resolveTextCaretAtRevision',
      revision: handle(),
      result: fixture.result,
    });
    await assert.rejects(pending, fixture.pattern);
  }
  client.dispose();
});

test('worker client rejects forged text-range endpoint, source, and rect semantics', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const request = rangeRequest();
  const cases = [
    rangeCase(
      rangeTransport(
        rangeRequest({ focus: caretAddress({ pageIndex: 6 }) }),
        rangeResponse(request),
      ),
      /request focus does not match/,
    ),
    rangeMutation(
      request,
      (range) => {
        range.anchor = caretAddress({ charIndex: 0 });
      },
      /range anchor does not match/,
    ),
    rangeMutation(
      request,
      (range) => {
        range.start = caretAddress({ charIndex: 0 });
      },
      /normalized endpoints unrelated/,
    ),
    rangeMutation(
      request,
      (range) => {
        range.selectedText = '\ud800';
      },
      /malformed UTF-16/,
    ),
    rangeMutation(
      request,
      (range) => {
        range.sourceLocator = {
          href: 'Text/chapter.xhtml',
          sourceRange: range.sourceLocator.sourceRange,
          progression: 0.5,
        };
      },
      /exact source range/,
    ),
    rangeMutation(
      request,
      (range) => {
        range.rects = [exactRect({ startCharIndex: 2, endCharIndex: 2 })];
      },
      /empty or reversed exact range rect/,
    ),
    rangeMutation(
      request,
      (range) => {
        range.rects = [exactRect({ pageIndex: 9 })];
      },
      /outside its endpoint pages/,
    ),
  ];

  for (const fixture of cases) {
    const pending = client.resolveTextRangeAtRevision(handle(), request);
    worker.respondLast({
      kind: 'resolveTextRangeAtRevision',
      revision: handle(),
      result: fixture.result,
    });
    await assert.rejects(pending, fixture.pattern);
  }
  client.dispose();
});

test('worker exact range rejects content forged onto a collapsed caret', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const endpoint = caretAddress();
  const request = { anchor: endpoint, focus: endpoint };
  const pending = client.resolveTextRangeAtRevision(handle(), request);
  worker.respondLast({
    kind: 'resolveTextRangeAtRevision',
    revision: handle(),
    result: rangeTransport(request, rangeResponse(request)),
  });

  await assert.rejects(pending, /content for a collapsed exact range/);
  client.dispose();
});

function caretCase(result, pattern) {
  return { result, pattern };
}

function rangeCase(result, pattern) {
  return { result, pattern };
}

function rangeMutation(request, mutate, pattern) {
  const response = structuredClone(rangeResponse(request));
  mutate(response.resolution.range);
  return rangeCase(rangeTransport(request, response), pattern);
}

async function openClient(worker) {
  const client = createRitoCoreWasmWorkerReaderClient(worker);
  const opening = client.open(new ArrayBuffer(0));
  await Promise.resolve();
  worker.respondLast({ kind: 'open', result: readerOpenResult({ title: 'fixture' }) });
  await opening;
  return client;
}
