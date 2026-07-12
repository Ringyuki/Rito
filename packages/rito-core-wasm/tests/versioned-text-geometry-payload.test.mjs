import assert from 'node:assert/strict';
import { test } from 'node:test';

import { versionedReaderWorkerPayload } from '../dist/reader-worker-versioned-payload-runtime.js';
import {
  crossLineOffsetsWithoutLf,
  geometryDocument,
  geometryRequest,
  handle,
  overlappingOffsets,
  pagePositionsRequest,
  pageTextPositions,
  positionsDocument,
  rangeRect,
  sameLineOffsetsWithLf,
  textRangeGeometry,
} from './versioned-text-geometry-fixtures.mjs';

test('payload binds successful geometry to a normalized request echo', () => {
  const request = geometryRequest({
    start: geometryRequest().request.end,
    end: geometryRequest().request.start,
  });
  const response = versionedReaderWorkerPayload(
    geometryDocument({ revision: handle(1), value: textRangeGeometry() }),
    request,
  );

  assert.deepEqual(response.result.request, geometryRequest().request);
  assert.deepEqual(response.result.geometry, textRangeGeometry());
});

test('payload rejects malformed text-position structures', () => {
  const cases = [
    payloadCase(
      positionsDocument({ revision: handle(2), value: pageTextPositions() }),
      /mismatched versioned responses/,
    ),
    payloadCase(
      positionsDocument({
        revision: handle(1),
        value: pageTextPositions({ textLength: 10 }),
      }),
      /inconsistent UTF-16 textLength/,
    ),
    payloadCase(
      positionsDocument({
        revision: handle(1),
        value: pageTextPositions({ offsets: overlappingOffsets() }),
      }),
      /cross-line LF/,
    ),
    payloadCase(
      positionsDocument({
        revision: handle(1),
        value: pageTextPositions({
          text: 'Helloworld',
          textLength: 10,
          offsets: crossLineOffsetsWithoutLf(),
        }),
      }),
      /cross-line LF/,
    ),
    payloadCase(
      positionsDocument({
        revision: handle(1),
        value: pageTextPositions({ offsets: sameLineOffsetsWithLf() }),
      }),
      /same-line text offset/,
    ),
    payloadCase(
      positionsDocument({
        revision: handle(1),
        value: pageTextPositions({
          text: '😀',
          textLength: 2,
          offsets: [
            { start: 0, end: 1, blockIndex: 0, lineIndex: 0, runIndex: 0 },
            { start: 1, end: 2, blockIndex: 0, lineIndex: 0, runIndex: 1 },
          ],
        }),
      }),
      /inside a surrogate pair/,
    ),
    payloadCase(
      positionsDocument({
        revision: handle(1),
        value: pageTextPositions({
          text: '\ud800',
          textLength: 1,
          offsets: [{ start: 0, end: 1, blockIndex: 0, lineIndex: 0, runIndex: 0 }],
        }),
      }),
      /malformed UTF-16 page text/,
    ),
  ];

  for (const fixture of cases) {
    assert.throws(
      () => versionedReaderWorkerPayload(fixture.document, pagePositionsRequest()),
      fixture.pattern,
    );
  }
});

test('payload rejects malformed, empty, or incomplete geometry', () => {
  const cases = [
    {
      request: geometryRequest({
        start: { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: -1 },
      }),
      value: textRangeGeometry(),
      pattern: /charIndex/,
    },
    { value: textRangeGeometry({ rectCount: 1 }), pattern: /inconsistent rectCount/ },
    { value: textRangeGeometry({ rects: [] }), pattern: /empty range geometry/ },
    {
      value: textRangeGeometry({ rects: [rangeRect(0, 0, 0, 0, 1)] }),
      pattern: /outside the requested text range/,
    },
    {
      value: textRangeGeometry({ rects: [rangeRect(0, 1, 0, 0, 3)] }),
      pattern: /cover both endpoints/,
    },
    {
      value: textRangeGeometry({
        rects: [rangeRect(0, 0, 0, 1, 3), rangeRect(0, 0, 0, 3, 5)],
      }),
      pattern: /multiple or unordered rects for one text run/,
    },
  ];

  for (const fixture of cases) {
    const document = geometryDocument({ revision: handle(1), value: fixture.value });
    assert.throws(
      () => versionedReaderWorkerPayload(document, fixture.request ?? geometryRequest()),
      fixture.pattern,
    );
  }
});

function payloadCase(document, pattern) {
  return { document, pattern };
}
