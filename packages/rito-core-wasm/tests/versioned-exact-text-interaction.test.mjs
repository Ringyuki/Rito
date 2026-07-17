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
  movementRequest,
  movementResponse,
  movementTransport,
  pointRequest,
  pointRangeRequest,
  pointRangeResponse,
  pointRangeTransport,
  rangeRequest,
  rangeResponse,
  rangeToPointRequest,
  rangeToPointResponse,
  rangeToPointTransport,
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
  assert.throws(
    () =>
      client.resolveTextRangeFromPointsAtRevision(
        handle(),
        pointRangeRequest({ granularity: 'sentence' }),
      ),
    /granularity must be word or paragraph/,
  );
  assert.throws(
    () =>
      client.resolveTextRangeToPointAtRevision(
        handle(),
        rangeToPointRequest({ focus: pointRequest({ x: Number.NaN }) }),
      ),
    /x must be finite/,
  );
  assert.throws(
    () =>
      client.resolveTextSelectionMovementAtRevision(
        handle(),
        movementRequest({ movement: 'visualTeleport' }),
      ),
    /invalid movement/,
  );
  assert.throws(
    () =>
      client.resolveTextSelectionMovementAtRevision(
        handle(),
        movementRequest({ preferredInlinePosition: Number.NaN }),
      ),
    /preferredInlinePosition must be finite/,
  );
  assert.throws(
    () =>
      client.resolveTextSelectionMovementAtRevision(
        handle(),
        movementRequest({ movement: 'wordStartRight', preferredInlinePosition: 28 }),
      ),
    /preferredInlinePosition is only valid for line movements/,
  );
  assert.equal(worker.messages.length, count);
  client.dispose();
});

test('worker client strictly binds exact selection movement requests and responses', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const request = movementRequest({ movement: 'wordStartRight' });
  const cases = [
    movementCase(
      movementTransport(movementRequest({ movement: 'lineUp' }), movementResponse(request)),
      /mismatched normalized request/,
    ),
    movementCase(
      movementTransport(
        movementRequest({ focus: caretAddress({ charIndex: 9 }) }),
        movementResponse(request),
      ),
      /request focus does not match/,
    ),
    movementMutation(
      request,
      (resolution) => {
        resolution.anchorCaret.address.charIndex = 9;
      },
      /anchor caret does not match/,
    ),
    movementMutation(
      request,
      (resolution) => {
        resolution.range.focus = { ...resolution.range.focus, charIndex: 9 };
      },
      /range focus does not match/,
    ),
    movementMutation(
      request,
      (resolution) => {
        resolution.preferredInlinePosition = Number.POSITIVE_INFINITY;
      },
      /preferredInlinePosition for a non-line movement/,
    ),
    movementMutation(
      movementRequest({ movement: 'lineDown' }),
      (resolution) => {
        delete resolution.preferredInlinePosition;
      },
      /line movement did not return preferredInlinePosition/,
    ),
    movementCase(
      movementTransport(request, {
        revisionId: 'rev-other',
        resolution: { status: 'pending', boundary: 'end' },
      }),
      /mismatched revisionId/,
    ),
    movementCase(
      movementTransport(request, {
        revisionId: 'rev-1',
        resolution: { status: 'boundary', boundary: 'middle' },
      }),
      /invalid text selection boundary/,
    ),
  ];

  for (const fixture of cases) {
    const pending = client.resolveTextSelectionMovementAtRevision(
      handle(),
      fixture.request ?? request,
    );
    worker.respondLast({
      kind: 'resolveTextSelectionMovementAtRevision',
      revision: handle(),
      result: fixture.result,
    });
    await assert.rejects(pending, fixture.pattern);
  }

  for (const resolution of [
    { status: 'boundary', boundary: 'start' },
    { status: 'pending', boundary: 'end' },
    { status: 'unavailable', reason: 'shapeUnavailable' },
  ]) {
    const pending = client.resolveTextSelectionMovementAtRevision(handle(), request);
    worker.respondLast({
      kind: 'resolveTextSelectionMovementAtRevision',
      revision: handle(),
      result: movementTransport(request, { revisionId: 'rev-1', resolution }),
    });
    assert.deepEqual((await pending).value.resolution, resolution);
  }

  const responseWithoutStickyPosition = movementResponse(request);
  delete responseWithoutStickyPosition.resolution.preferredInlinePosition;
  const pendingWithoutStickyPosition = client.resolveTextSelectionMovementAtRevision(
    handle(),
    movementRequest({ movement: 'wordStartRight', preferredInlinePosition: undefined }),
  );
  worker.respondLast({
    kind: 'resolveTextSelectionMovementAtRevision',
    revision: handle(),
    result: movementTransport(
      movementRequest({ movement: 'wordStartRight', preferredInlinePosition: undefined }),
      responseWithoutStickyPosition,
    ),
  });
  assert.equal(
    'preferredInlinePosition' in (await pendingWithoutStickyPosition).value.resolution,
    false,
  );
  client.dispose();
});

test('worker client preserves paragraph-start movement requests without aliasing', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);

  for (const movement of ['paragraphPreviousStart', 'paragraphNextStart']) {
    const request = movementRequest({ movement });
    const pending = client.resolveTextSelectionMovementAtRevision(handle(), request);
    assert.deepEqual(worker.messages.at(-1), {
      id: worker.messages.at(-1).id,
      kind: 'resolveTextSelectionMovementAtRevision',
      revision: handle(),
      request,
    });
    worker.respondLast({
      kind: 'resolveTextSelectionMovementAtRevision',
      revision: handle(),
      result: movementTransport(request, movementResponse(request)),
    });
    assert.deepEqual((await pending).value, movementResponse(request));
  }

  client.dispose();
});

test('worker client strictly binds granular point-range requests, endpoints, and sources', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const request = pointRangeRequest();
  const cases = [
    pointRangeCase(
      pointRangeTransport(
        pointRangeRequest({ granularity: 'paragraph' }),
        pointRangeResponse(request),
      ),
      /mismatched normalized request/,
    ),
    pointRangeCase(
      pointRangeTransport(
        pointRangeRequest({ anchor: pointRequest({ x: 99 }) }),
        pointRangeResponse(request),
      ),
      /mismatched normalized request/,
    ),
    pointRangeMutation(
      request,
      (resolution) => {
        resolution.anchorCaret.address = {
          ...resolution.anchorCaret.address,
          pageIndex: 5,
        };
      },
      /range anchor does not match/,
    ),
    pointRangeMutation(
      request,
      (resolution) => {
        resolution.focusCaret.geometry.height = 0;
      },
      /height must be positive/,
    ),
    pointRangeMutation(
      request,
      (resolution) => {
        resolution.range.anchor = { ...resolution.range.anchor, charIndex: 0 };
      },
      /range anchor does not match/,
    ),
    pointRangeMutation(
      request,
      (resolution) => {
        resolution.range.sourceLocator.sourceRange.start.textOffset = 2;
      },
      /source endpoints unrelated/,
    ),
    pointRangeMutation(
      request,
      (resolution) => {
        resolution.anchorCaret.sourceLocator = {
          href: 'Text/chapter.xhtml',
          sourceRange: resolution.range.sourceLocator.sourceRange,
        };
      },
      /exact source point/,
    ),
    pointRangeCase(
      pointRangeTransport(request, {
        revisionId: 'rev-1',
        resolution: {
          status: 'miss',
          range: pointRangeResponse(request).resolution.range,
        },
      }),
      /returned range for status miss/,
    ),
    pointRangeCase(
      pointRangeTransport(request, {
        revisionId: 'rev-1',
        resolution: {
          status: 'unavailable',
          reason: 'shapeUnavailable',
          anchorCaret: pointRangeResponse(request).resolution.anchorCaret,
        },
      }),
      /returned anchorCaret for status unavailable/,
    ),
  ];

  for (const fixture of cases) {
    const pending = client.resolveTextRangeFromPointsAtRevision(handle(), request);
    worker.respondLast({
      kind: 'resolveTextRangeFromPointsAtRevision',
      revision: handle(),
      result: fixture.result,
    });
    await assert.rejects(pending, fixture.pattern);
  }
  client.dispose();
});

test('worker client strictly binds range-to-point request echoes and current carets', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const request = rangeToPointRequest();
  const cases = [
    rangeToPointCase(
      rangeToPointTransport(
        rangeToPointRequest({ anchor: caretAddress({ charIndex: 0 }) }),
        rangeToPointResponse(request),
      ),
      /request anchor does not match/,
    ),
    rangeToPointCase(
      rangeToPointTransport(
        rangeToPointRequest({ focus: pointRequest({ pageIndex: 5, x: 99, y: 44 }) }),
        rangeToPointResponse(request),
      ),
      /mismatched normalized request/,
    ),
    rangeToPointMutation(
      request,
      (resolution) => {
        resolution.anchorCaret.address.affinity = 'upstream';
      },
      /anchor caret does not match/,
    ),
    rangeToPointMutation(
      request,
      (resolution) => {
        resolution.focusCaret.address = {
          ...resolution.focusCaret.address,
          pageIndex: request.focus.pageIndex + 1,
        };
        resolution.range.focus = resolution.focusCaret.address;
        resolution.range.end = resolution.focusCaret.address;
      },
      /focusCaret for a mismatched pageIndex/,
    ),
  ];

  for (const fixture of cases) {
    const pending = client.resolveTextRangeToPointAtRevision(handle(), request);
    worker.respondLast({
      kind: 'resolveTextRangeToPointAtRevision',
      revision: handle(),
      result: fixture.result,
    });
    await assert.rejects(pending, fixture.pattern);
  }
  client.dispose();
});

test('worker granular point range preserves miss and unavailable resolutions', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const request = pointRangeRequest();
  for (const resolution of [
    { status: 'miss' },
    { status: 'unavailable', reason: 'shapeUnavailable' },
  ]) {
    const pending = client.resolveTextRangeFromPointsAtRevision(handle(), request);
    worker.respondLast({
      kind: 'resolveTextRangeFromPointsAtRevision',
      revision: handle(),
      result: pointRangeTransport(request, { revisionId: 'rev-1', resolution }),
    });
    assert.deepEqual((await pending).value.resolution, resolution);
  }
  client.dispose();
});

test('worker granular point range accepts an expanded endpoint on an adjacent page', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const request = pointRangeRequest();
  const response = structuredClone(pointRangeResponse(request));
  const expanded = caretAddress({ pageIndex: 3 });
  response.resolution.anchorCaret.address = expanded;
  response.resolution.range.anchor = expanded;
  response.resolution.range.start = expanded;
  response.resolution.range.rects[0].pageIndex = 3;
  response.resolution.range.rects[0].spreadIndex = 1;
  const pending = client.resolveTextRangeFromPointsAtRevision(handle(), request);
  worker.respondLast({
    kind: 'resolveTextRangeFromPointsAtRevision',
    revision: handle(),
    result: pointRangeTransport(request, response),
  });

  const result = await pending;
  assert.equal(result.value.resolution.status, 'resolved');
  assert.equal(result.value.resolution.anchorCaret.address.pageIndex, 3);
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

function pointRangeCase(result, pattern) {
  return { result, pattern };
}

function pointRangeMutation(request, mutate, pattern) {
  const response = structuredClone(pointRangeResponse(request));
  mutate(response.resolution);
  return pointRangeCase(pointRangeTransport(request, response), pattern);
}

function rangeToPointCase(result, pattern) {
  return { result, pattern };
}

function rangeToPointMutation(request, mutate, pattern) {
  const response = structuredClone(rangeToPointResponse(request));
  mutate(response.resolution);
  return rangeToPointCase(rangeToPointTransport(request, response), pattern);
}

function movementCase(result, pattern) {
  return { result, pattern };
}

function movementMutation(request, mutate, pattern) {
  const response = structuredClone(movementResponse(request));
  mutate(response.resolution);
  return { ...movementCase(movementTransport(request, response), pattern), request };
}

async function openClient(worker) {
  const client = createRitoCoreWasmWorkerReaderClient(worker);
  const opening = client.open(new ArrayBuffer(0));
  await Promise.resolve();
  worker.respondLast({ kind: 'open', result: readerOpenResult({ title: 'fixture' }) });
  await opening;
  return client;
}
