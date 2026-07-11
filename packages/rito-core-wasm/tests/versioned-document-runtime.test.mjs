import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmDocumentRuntime } from '../dist/core-wasm-document-runtime.js';

const { RitoCoreWasmDocument } = createRitoCoreWasmDocumentRuntime(
  async () => {},
  unusedRawDocument,
);

test('bounded control accepts only sequential Rust revision transitions', () => {
  const requests = [];
  const raw = {
    createBoundedRevisionJson: (json) => {
      requests.push(JSON.parse(json));
      return JSON.stringify(advance(0, 'ready', true));
    },
    continueRevisionJson: (json) => {
      requests.push(JSON.parse(json));
      return JSON.stringify(advance(1, 'complete', false));
    },
    cancelRevisionJson: (json) => {
      requests.push(JSON.parse(json));
      return JSON.stringify(summary(2, 'cancelled'));
    },
  };
  const document = new RitoCoreWasmDocument(raw);
  const created = document.createBoundedRevision({ layoutConfig: {}, budget: budget() });
  const continued = document.continueRevision({
    revisionId: 'rev-1',
    revisionVersion: 0,
    cursor: 'cursor-1',
    budget: budget(),
  });
  const cancelled = document.cancelRevision({ revisionId: 'rev-1', revisionVersion: 1 });

  assert.equal(created.revision.revisionVersion, 0);
  assert.deepEqual(created.continuation, {
    revisionId: 'rev-1',
    revisionVersion: 0,
    cursor: 'cursor-1',
  });
  assert.equal(continued.revision.revisionVersion, 1);
  assert.equal(cancelled.revisionVersion, 2);
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(requests[1], {
    revisionId: 'rev-1',
    revisionVersion: 0,
    cursor: 'cursor-1',
    budget: budget(),
  });
});

test('bounded control rejects skipped versions, malformed summaries, and wrong cancel status', () => {
  const document = new RitoCoreWasmDocument({
    createBoundedRevisionJson: () => JSON.stringify(advance(1, 'ready', true)),
    continueRevisionJson: () => JSON.stringify(advance(3, 'ready', true)),
    cancelRevisionJson: () => JSON.stringify(summary(2, 'ready')),
  });

  assert.throws(
    () => document.createBoundedRevision({ layoutConfig: {}, budget: budget() }),
    /non-sequential revisionVersion/,
  );
  assert.throws(
    () =>
      document.continueRevision({
        revisionId: 'rev-1',
        revisionVersion: 1,
        cursor: 'cursor-2',
        budget: budget(),
      }),
    /non-sequential revisionVersion/,
  );
  assert.throws(
    () => document.cancelRevision({ revisionId: 'rev-1', revisionVersion: 1 }),
    /invalid revision status/,
  );

  const inconsistent = new RitoCoreWasmDocument({
    createBoundedRevisionJson: () =>
      JSON.stringify({
        ...advance(0, 'ready', false),
        revision: { ...summary(0, 'ready'), pageCount: 9 },
      }),
  });
  assert.throws(
    () => inconsistent.createBoundedRevision({ layoutConfig: {}, budget: budget() }),
    /inconsistent revision extent aliases/,
  );

  const base = summary(0, 'ready');
  const malformed = [
    { ...base, layoutKey: '' },
    {
      ...base,
      knownExtent: { pageCount: 1, spreadCount: 2 },
      pageCount: 1,
      spreadCount: 2,
    },
    { ...base, finalExtent: base.knownExtent },
    { ...summary(0, 'complete'), finalExtent: undefined },
    { ...summary(0, 'complete'), finalExtent: { pageCount: 0, spreadCount: 0 } },
  ];
  for (const revision of malformed) {
    const invalid = new RitoCoreWasmDocument({
      createBoundedRevisionJson: () => JSON.stringify({ ...advance(0, 'ready', false), revision }),
    });
    assert.throws(() => invalid.createBoundedRevision({ layoutConfig: {}, budget: budget() }));
  }
});

test('all versioned direct methods validate and echo the complete handle', () => {
  const calls = [];
  const handle = { revisionId: 'rev-7', revisionVersion: 4 };
  const raw = new Proxy(
    {
      readFrameCommandBufferAtRevision: (...args) => {
        calls.push(['readFrameCommandBufferAtRevision', args]);
        return Uint8Array.of(1, 2, 3);
      },
    },
    {
      get(target, property) {
        if (property in target) return target[property];
        return (...args) => {
          calls.push([property, args]);
          const version = args[1];
          const value =
            property === 'getRevisionSummaryAtRevisionJson'
              ? summary(version, 'ready', args[0])
              : property === 'getRevisionBundleAtRevisionJson'
                ? bundle(version, args[0])
                : { rawMethod: property };
          return JSON.stringify({
            revision: { revisionId: args[0], revisionVersion: args[1] },
            value,
          });
        };
      },
    },
  );
  const document = new RitoCoreWasmDocument(raw);
  const invocations = [
    () => document.getFrameAtRevision(handle, 0),
    () => document.getFrameCommandBufferMetadataAtRevision(handle, 0),
    () => document.getResourcePayloadAtRevision(handle, 'image', 'cover.png'),
    () => document.prefetchResourcesAtRevision(handle, { resources: [] }),
    () => document.prefetchPlannedFrameResourcesAtRevision(handle, 0),
    () => document.searchAtRevision(handle, { query: 'x' }),
    () => document.resolveLocatorAtRevision(handle, { href: 'chapter.xhtml' }),
    () => document.resolveSourceLocatorAtRevision(handle, { href: 'chapter.xhtml' }),
    () => document.getPageTargetsAtRevision(handle, 0),
    () => document.getPageTextPositionsAtRevision(handle, 0),
    () => document.getTextRangeGeometryAtRevision(handle, { pageIndex: 0 }),
    () => document.getFootnoteAtRevision(handle, 'chapter.xhtml#fn1'),
    () => document.getFootnotesAtRevision(handle),
    () => document.getChapterTextIndicesAtRevision(handle),
    () => document.getRevisionSummaryAtRevision(handle),
    () => document.getRevisionBundleAtRevision(handle, true),
    () => document.getRevisionNavigationAtRevision(handle),
    () => document.releaseRevisionTransfersAtRevision(handle),
    () => document.releaseRevisionAtRevision(handle),
  ];

  for (const invoke of invocations) {
    const response = invoke();
    assert.deepEqual(response.revision, handle);
    assert.ok(Object.hasOwn(response, 'value'));
  }
  const bytes = document.readFrameCommandBufferAtRevision(handle, 0);
  assert.deepEqual(bytes, { revision: handle, value: Uint8Array.of(1, 2, 3) });
  assert.ok(calls.every(([, args]) => args[0] === 'rev-7' && args[1] === 4));
});

test('versioned direct methods reject invalid input and mismatched raw envelopes', () => {
  const document = new RitoCoreWasmDocument({
    getRevisionSummaryAtRevisionJson: () =>
      JSON.stringify({
        revision: { revisionId: 'rev-other', revisionVersion: 1 },
        value: summary(1, 'ready'),
      }),
  });

  assert.throws(
    () => document.getRevisionSummaryAtRevision('rev-1'),
    (error) => error.code === 'bad-request' && /input must be an object/.test(error.message),
  );
  assert.throws(
    () => document.getRevisionSummaryAtRevision({ revisionId: 'rev-1', revisionVersion: -1 }),
    (error) => error.code === 'bad-request' && /unsigned 32-bit/.test(error.message),
  );
  assert.throws(
    () => document.getRevisionSummaryAtRevision({ revisionId: 'rev-1', revisionVersion: 1 }),
    /mismatched revision handle/,
  );
});

function advance(version, status, continuing) {
  const revision = summary(version, status);
  return {
    revision,
    previousKnownExtent: { pageCount: 0, spreadCount: 0 },
    newlyKnownPages: { startPage: 0, endPageExclusive: revision.pageCount },
    processedTopLevelNodes: 1,
    ...(continuing
      ? {
          continuation: {
            revisionId: revision.revisionId,
            revisionVersion: version,
            cursor: `cursor-${String(version + 1)}`,
          },
        }
      : {}),
  };
}

function summary(version, status, revisionId = 'rev-1') {
  const knownExtent = { pageCount: 1, spreadCount: 1 };
  return {
    revisionId,
    revisionVersion: version,
    layoutKey: 'layout',
    status,
    knownExtent,
    ...(status === 'complete' ? { finalExtent: knownExtent } : {}),
    pageCount: knownExtent.pageCount,
    spreadCount: knownExtent.spreadCount,
  };
}

function bundle(version, revisionId = 'rev-1') {
  return {
    revision: summary(version, 'ready', revisionId),
    navigation: { revisionId },
    tocTargets: { revisionId, targets: [] },
    footnotes: { revisionId, entries: {} },
    chapterTextIndices: { revisionId, entries: {} },
    fontFamilies: [],
  };
}

function budget() {
  return { maxTopLevelNodes: 1 };
}

function unusedRawDocument() {
  throw new Error('fixture constructs the wrapped document directly');
}
