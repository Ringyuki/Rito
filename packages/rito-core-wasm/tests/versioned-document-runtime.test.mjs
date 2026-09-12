import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmDocumentRuntime } from '../dist/core-wasm-document-runtime.js';
import {
  caretResponse,
  pointRangeRequest,
  pointRangeResponse,
  pointRequest,
  rangeRequest,
  rangeResponse,
  rangeToPointRequest,
  rangeToPointResponse,
} from './versioned-exact-text-interaction-fixtures.mjs';

const { RitoCoreWasmDocument } = createRitoCoreWasmDocumentRuntime(
  async () => {},
  unusedRawDocument,
);

test('bounded control publishes the created revision at version zero', () => {
  const requests = [];
  const raw = {
    createBoundedRevisionJson: (json) => {
      requests.push(JSON.parse(json));
      return JSON.stringify(advance(0, 'complete'));
    },
  };
  const document = new RitoCoreWasmDocument(raw);
  const created = document.createBoundedRevision({ layoutConfig: {} });

  assert.equal(created.revision.revisionVersion, 0);
  assert.equal(created.revision.status, 'complete');
  assert.deepEqual(created.newlyKnownPages, { startPage: 0, endPageExclusive: 1 });
  assert.deepEqual(requests, [{ layoutConfig: {} }]);
});

test('bounded control rejects skipped versions and malformed summaries', () => {
  const document = new RitoCoreWasmDocument({
    createBoundedRevisionJson: () => JSON.stringify(advance(1, 'complete')),
  });

  assert.throws(
    () => document.createBoundedRevision({ layoutConfig: {} }),
    /non-sequential revisionVersion/,
  );

  const inconsistent = new RitoCoreWasmDocument({
    createBoundedRevisionJson: () =>
      JSON.stringify({
        ...advance(0, 'complete'),
        revision: { ...summary(0, 'complete'), pageCount: 9 },
      }),
  });
  assert.throws(
    () => inconsistent.createBoundedRevision({ layoutConfig: {} }),
    /inconsistent revision extent aliases/,
  );

  const base = summary(0, 'complete');
  const malformed = [
    { ...base, layoutKey: '' },
    {
      ...base,
      knownExtent: { pageCount: 1, spreadCount: 2 },
      pageCount: 1,
      spreadCount: 2,
    },
    { ...summary(0, 'ready') },
    { ...summary(0, 'complete'), finalExtent: undefined },
    { ...summary(0, 'complete'), finalExtent: { pageCount: 0, spreadCount: 0 } },
  ];
  for (const revision of malformed) {
    const invalid = new RitoCoreWasmDocument({
      createBoundedRevisionJson: () => JSON.stringify({ ...advance(0, 'complete'), revision }),
    });
    assert.throws(() => invalid.createBoundedRevision({ layoutConfig: {} }));
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
          const value = versionedValue(property, args, version);
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
    () => document.getFrameCommandBufferMetadataAtRevision(handle, 0),
    () => document.getResourcePayloadAtRevision(handle, 'image', 'cover.png'),
    () => document.prefetchResourcesAtRevision(handle, { resources: [] }),
    () => document.prefetchPlannedFrameResourcesAtRevision(handle, 0),
    () =>
      document.searchAtRevision(handle, {
        query: 'x',
        caseSensitive: false,
        wholeWord: false,
      }),
    () => document.resolveLocatorAtRevision(handle, { href: 'chapter.xhtml' }),
    () => document.resolveSourceLocatorAtRevision(handle, { href: 'chapter.xhtml' }),
    () => document.getPageTargetsAtRevision(handle, 0),
    () => document.getPageTextPositionsAtRevision(handle, 0),
    () => document.getTextRangeGeometryAtRevision(handle, { pageIndex: 0 }),
    () => document.resolveTextCaretAtRevision(handle, pointRequest()),
    () => document.resolveTextRangeAtRevision(handle, rangeRequest()),
    () => document.resolveTextRangeFromPointsAtRevision(handle, pointRangeRequest()),
    () => document.resolveTextRangeToPointAtRevision(handle, rangeToPointRequest()),
    () => document.getFootnoteAtRevision(handle, 'chapter.xhtml#fn1'),
    () => document.getFootnotesAtRevision(handle),
    () => document.getChapterTextIndicesAtRevision(handle),
    () => document.getRevisionSummaryAtRevision(handle),
    () => document.getRevisionBundleAtRevision(handle, true),
    () => document.getRevisionPresentationAtRevision(handle),
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
  assert.ok(
    calls.some(([name, args]) => name === 'getRevisionBundleAtRevisionJson' && args[2] === true),
  );
});

test('versioned direct methods reject invalid input and mismatched raw envelopes', () => {
  const document = new RitoCoreWasmDocument({
    getRevisionSummaryAtRevisionJson: () =>
      JSON.stringify({
        revision: { revisionId: 'rev-other', revisionVersion: 1 },
        value: summary(1, 'complete'),
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

function advance(version, status) {
  const revision = summary(version, status);
  return {
    revision,
    newlyKnownPages: { startPage: 0, endPageExclusive: revision.pageCount },
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
    revision: summary(version, 'complete', revisionId),
    navigation: { revisionId },
    tocTargets: { revisionId, targets: [] },
    footnotes: { revisionId, complete: true, pendingKeys: [], entries: {} },
    chapterTextIndices: { revisionId, entries: {} },
    fontFamilies: [],
  };
}

function presentation(version, revisionId = 'rev-1') {
  const revision = summary(version, 'complete', revisionId);
  return {
    revision,
    navigation: {
      revisionId,
      ...revision.knownExtent,
      spreads: [{ spreadIndex: 0, pageIndexes: [0], leftPageIndex: 0 }],
      chapters: [],
      chapterMap: {},
    },
    tocTargets: { revisionId, targets: [] },
    fontFamilies: [],
  };
}

function versionedValue(property, args, version) {
  const revisionId = args[0];
  if (property === 'getRevisionSummaryAtRevisionJson') {
    return summary(version, 'complete', revisionId);
  }
  if (property === 'getRevisionBundleAtRevisionJson') return bundle(version, revisionId);
  if (property === 'getRevisionPresentationAtRevisionJson') {
    return presentation(version, revisionId);
  }
  if (property === 'resolveTextCaretAtRevisionJson') return caretResponse({ revisionId });
  if (property === 'resolveTextRangeAtRevisionJson') {
    return rangeResponse(JSON.parse(args[2]), { revisionId });
  }
  if (property === 'resolveTextRangeFromPointsAtRevisionJson') {
    return pointRangeResponse(JSON.parse(args[2]), { revisionId });
  }
  if (property === 'resolveTextRangeToPointAtRevisionJson') {
    return rangeToPointResponse(JSON.parse(args[2]), { revisionId });
  }
  if (property === 'getFootnotesAtRevisionJson') {
    return { revisionId, complete: true, pendingKeys: [], entries: {} };
  }
  if (property === 'getChapterTextIndicesAtRevisionJson') {
    return { revisionId, entries: {} };
  }
  if (property === 'searchAtRevisionJson') {
    const request = JSON.parse(args[2]);
    return { revisionId, ...request, resultCount: 0, results: [] };
  }
  return { rawMethod: property };
}

function unusedRawDocument() {
  throw new Error('fixture constructs the wrapped document directly');
}
