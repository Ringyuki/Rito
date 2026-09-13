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

test('revision control publishes the created revision at version zero', () => {
  const requests = [];
  const raw = {
    createRevisionJson: (json) => {
      requests.push(JSON.parse(json));
      return JSON.stringify(summary(0));
    },
  };
  const document = new RitoCoreWasmDocument(raw);
  const created = document.createRevision({});

  assert.deepEqual(created, summary(0));
  assert.deepEqual(requests, [{}]);
});

test('revision control rejects skipped versions and malformed summaries', () => {
  const document = new RitoCoreWasmDocument({
    createRevisionJson: () => JSON.stringify(summary(1)),
  });

  assert.throws(() => document.createRevision({}), /non-sequential revisionVersion/);

  const inconsistent = new RitoCoreWasmDocument({
    createRevisionJson: () => JSON.stringify({ ...summary(0), spreadCount: 9 }),
  });
  assert.throws(() => inconsistent.createRevision({}), /more spreads than pages/);

  const base = summary(0);
  const malformed = [
    { ...base, layoutKey: '' },
    { ...base, pageCount: -1 },
    { ...base, spreadCount: undefined },
    { ...base, pageCount: 1.5 },
  ];
  for (const revision of malformed) {
    const invalid = new RitoCoreWasmDocument({
      createRevisionJson: () => JSON.stringify(revision),
    });
    assert.throws(() => invalid.createRevision({}));
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
        value: summary(1),
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

function summary(version, revisionId = 'rev-1') {
  return {
    revisionId,
    revisionVersion: version,
    layoutKey: 'layout',
    pageCount: 1,
    spreadCount: 1,
  };
}

function bundle(version, revisionId = 'rev-1') {
  return {
    revision: summary(version, revisionId),
    navigation: { revisionId },
    tocTargets: { revisionId, targets: [] },
    footnotes: { revisionId, complete: true, pendingKeys: [], entries: {} },
    chapterTextIndices: { revisionId, entries: {} },
    fontFamilies: [],
  };
}

function presentation(version, revisionId = 'rev-1') {
  const revision = summary(version, revisionId);
  return {
    revision,
    navigation: {
      revisionId,
      pageCount: revision.pageCount,
      spreadCount: revision.spreadCount,
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
    return summary(version, revisionId);
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
