import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmDocumentRuntime } from '../dist/core-wasm-document-runtime.js';
import { createRitoCoreWasmWorkerReaderClient } from '../dist/reader-worker-client-runtime.js';
import { readerOpenResult } from './reader-worker-test-fixture.mjs';

const { RitoCoreWasmDocument } = createRitoCoreWasmDocumentRuntime(
  async () => {},
  unusedRawDocument,
);

test('direct bounded revisions reject forged progress, range, continuation, and status semantics', () => {
  const forgeries = [
    { ...advance(0, 'ready', true), processedTopLevelNodes: 2 },
    {
      ...advance(0, 'ready', true),
      newlyKnownPages: { startPage: 0, endPageExclusive: 2 },
    },
    {
      ...advance(0, 'ready', true),
      previousKnownExtent: { pageCount: 1, spreadCount: 1 },
    },
    { ...advance(0, 'ready', true), continuation: undefined },
    {
      ...advance(0, 'complete', false),
      continuation: { ...handle(0), cursor: 'cursor-forged' },
    },
    {
      ...advance(0, 'ready', true),
      continuation: { ...handle(0), cursor: '' },
    },
    { ...advance(0, 'cancelled', false) },
    advanceWithExtent(0, 'warming', 1, 1),
    advanceWithExtent(0, 'ready', 1, 0),
  ];
  for (const forged of forgeries) {
    const document = new RitoCoreWasmDocument({
      createBoundedRevisionJson: () => JSON.stringify(forged),
    });
    assert.throws(() => document.createBoundedRevision({ layoutConfig: {}, budget: budget() }));
  }
});

test('direct versioned reads reject matching envelopes with forged embedded revisions', () => {
  for (const [method, value] of [
    ['getRevisionSummaryAtRevisionJson', summary(2, 'ready')],
    ['getRevisionBundleAtRevisionJson', bundle(2)],
  ]) {
    const document = new RitoCoreWasmDocument({
      [method]: () => JSON.stringify({ revision: handle(1), value }),
    });
    const invoke =
      method === 'getRevisionSummaryAtRevisionJson'
        ? () => document.getRevisionSummaryAtRevision(handle(1))
        : () => document.getRevisionBundleAtRevision(handle(1));
    assert.throws(invoke, /mismatched revision|non-sequential revisionVersion/);
  }

  const value = bundle(1);
  value.navigation = { ...value.navigation, revisionId: 'rev-other' };
  const document = new RitoCoreWasmDocument({
    getRevisionBundleAtRevisionJson: () => JSON.stringify({ revision: handle(1), value }),
  });
  assert.throws(
    () => document.getRevisionBundleAtRevision(handle(1)),
    /navigation returned a mismatched revisionId/,
  );

  const fontBundle = bundle(1);
  fontBundle.requiredFontFaces = {
    schemaVersion: 1,
    revisionId: 'rev-other',
    faces: [],
  };
  const fontDocument = new RitoCoreWasmDocument({
    getRevisionBundleAtRevisionJson: () =>
      JSON.stringify({ revision: handle(1), value: fontBundle }),
  });
  assert.throws(
    () => fontDocument.getRevisionBundleAtRevision(handle(1)),
    /requiredFontFaces identity/,
  );

  const forgedPresentation = presentation(1);
  forgedPresentation.chapterTextIndices = { revisionId: 'rev-1', entries: {} };
  const presentationDocument = new RitoCoreWasmDocument({
    getRevisionPresentationAtRevisionJson: () =>
      JSON.stringify({ revision: handle(1), value: forgedPresentation }),
  });
  assert.throws(
    () => presentationDocument.getRevisionPresentationAtRevision(handle(1)),
    /unexpected presentation field: chapterTextIndices/,
  );

  const malformedPresentations = [
    { ...presentation(1), navigation: { ...presentation(1).navigation, spreads: [{}] } },
    {
      ...presentation(1),
      navigation: {
        ...presentation(1).navigation,
        chapters: [{ idref: 'chapter', href: 'chapter.xhtml', linear: true }],
        chapterMap: {
          chapter: { startPage: 0, endPage: 2, pageCount: 3, blockCount: 1 },
        },
      },
    },
    {
      ...presentation(1),
      tocTargets: {
        revisionId: 'rev-1',
        targets: [{ entry: {}, pageIndex: 0, spreadIndex: 0 }],
      },
    },
  ];
  for (const value of malformedPresentations) {
    const invalid = new RitoCoreWasmDocument({
      getRevisionPresentationAtRevisionJson: () => JSON.stringify({ revision: handle(1), value }),
    });
    assert.throws(() => invalid.getRevisionPresentationAtRevision(handle(1)));
  }
});

test('direct exact aggregate reads reject forged identities and request echoes', () => {
  const footnotes = new RitoCoreWasmDocument({
    getFootnotesAtRevisionJson: () =>
      JSON.stringify({
        revision: handle(1),
        value: { revisionId: 'rev-other', entries: {} },
      }),
  });
  assert.throws(() => footnotes.getFootnotesAtRevision(handle(1)), /mismatched revisionId/);

  const indices = new RitoCoreWasmDocument({
    getChapterTextIndicesAtRevisionJson: () =>
      JSON.stringify({
        revision: handle(1),
        value: {
          revisionId: 'rev-1',
          entries: {
            'chapter.xhtml': {
              href: 'chapter.xhtml',
              normalizedText: 'A',
              spans: [{ nodePath: [-1] }],
            },
          },
        },
      }),
  });
  assert.throws(
    () => indices.getChapterTextIndicesAtRevision(handle(1)),
    /invalid chapter text node path/,
  );

  const search = new RitoCoreWasmDocument({
    searchAtRevisionJson: (_revisionId, _version, requestJson) =>
      JSON.stringify({
        revision: handle(1),
        value: {
          revisionId: 'rev-1',
          ...JSON.parse(requestJson),
          query: 'forged',
          resultCount: 0,
          results: [],
        },
      }),
  });
  assert.throws(() => search.searchAtRevision(handle(1), searchRequest()), /mismatched query/);
  assert.throws(
    () => search.searchAtRevision(handle(1), { query: 'A', caseSensitive: false }),
    /wholeWord must be a boolean/,
  );

  const sourcedSearch = new RitoCoreWasmDocument({
    searchAtRevisionJson: (_revisionId, _version, requestJson) =>
      JSON.stringify({
        revision: handle(1),
        value: {
          revisionId: 'rev-1',
          ...JSON.parse(requestJson),
          resultCount: 1,
          results: [searchResult(searchSource())],
        },
      }),
  });
  assert.deepEqual(
    sourcedSearch.searchAtRevision(handle(1), searchRequest()).value.results[0].source,
    searchSource(),
  );

  for (const source of [
    undefined,
    { status: 'pending', reason: 'notPaginated' },
    { status: 'unavailable', reason: 'shapeUnavailable' },
    { status: 'resolved', href: 'chapter.xhtml', sourceRange: { start: {}, end: {} } },
  ]) {
    const malformed = new RitoCoreWasmDocument({
      searchAtRevisionJson: (_revisionId, _version, requestJson) =>
        JSON.stringify({
          revision: handle(1),
          value: {
            revisionId: 'rev-1',
            ...JSON.parse(requestJson),
            resultCount: 1,
            results: [searchResult(source)],
          },
        }),
    });
    assert.throws(() => malformed.searchAtRevision(handle(1), searchRequest()));
  }
});

test('worker client rejects forged bounded and summary results behind a matching envelope', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);

  let pending = client.createBoundedRevision({ layoutConfig: {}, budget: budget() });
  worker.respondLast({
    kind: 'createBoundedRevision',
    revision: handle(0),
    result: { ...advance(0, 'ready', true), revision: summary(1, 'ready') },
  });
  await rejectMalformedMutation(
    worker,
    pending,
    handle(0),
    /mismatched revision|non-sequential revisionVersion/,
  );

  pending = client.createBoundedRevision({ layoutConfig: {}, budget: budget() });
  worker.respondLast({
    kind: 'createBoundedRevision',
    revision: handle(0),
    result: { ...advance(0, 'ready', true), processedTopLevelNodes: 2 },
  });
  await rejectMalformedMutation(worker, pending, handle(0), /exceeded its top-level node budget/);

  pending = client.continueRevision({ ...handle(1), cursor: 'cursor-1', budget: budget() });
  const continued = advance(2, 'ready', true);
  continued.continuation = { ...handle(3), cursor: 'cursor-3' };
  worker.respondLast({ kind: 'continueRevision', revision: handle(2), result: continued });
  await rejectMalformedMutation(worker, pending, handle(2), /mismatched revision handle/);

  pending = client.cancelRevision(handle(1));
  worker.respondLast({
    kind: 'cancelRevision',
    revision: handle(2),
    result: summary(2, 'ready'),
  });
  await rejectMalformedMutation(worker, pending, handle(2), /invalid revision status/);

  pending = client.getRevisionSummaryAtRevision(handle(1));
  worker.respondLast({
    kind: 'getRevisionSummaryAtRevision',
    revision: handle(1),
    result: summary(2, 'ready'),
  });
  await assert.rejects(pending, /non-sequential revisionVersion/);
  client.dispose();
});

async function rejectMalformedMutation(worker, pending, revision, pattern) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (worker.messages.at(-1).kind === 'releaseRevisionAtRevision') break;
    await Promise.resolve();
  }
  const rollback = worker.messages.at(-1);
  assert.equal(rollback.kind, 'releaseRevisionAtRevision');
  assert.deepEqual(rollback.revision, revision);
  worker.respondLast({
    kind: 'releaseRevisionAtRevision',
    revision,
    result: { releasedRevision: true, releasedTransferCount: 0 },
  });
  await assert.rejects(pending, pattern);
}

function advance(version, status, continuing) {
  const revision = summary(version, status);
  return {
    revision,
    previousKnownExtent: { pageCount: 0, spreadCount: 0 },
    newlyKnownPages: { startPage: 0, endPageExclusive: revision.pageCount },
    processedTopLevelNodes: 1,
    ...(continuing
      ? { continuation: { ...handle(version), cursor: `cursor-${String(version + 1)}` } }
      : {}),
  };
}

function advanceWithExtent(version, status, pageCount, spreadCount) {
  const result = advance(version, status, status !== 'complete');
  const knownExtent = { pageCount, spreadCount };
  result.revision = {
    ...result.revision,
    knownExtent,
    pageCount,
    spreadCount,
  };
  result.newlyKnownPages = { startPage: 0, endPageExclusive: pageCount };
  return result;
}

function summary(version, status) {
  const knownExtent = { pageCount: 1, spreadCount: 1 };
  return {
    ...handle(version),
    layoutKey: 'layout',
    status,
    knownExtent,
    ...(status === 'complete' ? { finalExtent: knownExtent } : {}),
    pageCount: 1,
    spreadCount: 1,
  };
}

function bundle(version) {
  const revisionId = 'rev-1';
  return {
    revision: summary(version, 'ready'),
    navigation: { revisionId },
    tocTargets: { revisionId, targets: [] },
    footnotes: { revisionId, entries: {} },
    chapterTextIndices: { revisionId, entries: {} },
    fontFamilies: [],
  };
}

function presentation(version) {
  return {
    revision: summary(version, 'ready'),
    navigation: {
      revisionId: 'rev-1',
      pageCount: 1,
      spreadCount: 1,
      spreads: [{ spreadIndex: 0, pageIndexes: [0], leftPageIndex: 0 }],
      chapters: [],
      chapterMap: {},
    },
    tocTargets: { revisionId: 'rev-1', targets: [] },
    fontFamilies: [],
  };
}

function handle(revisionVersion) {
  return { revisionId: 'rev-1', revisionVersion };
}

function budget() {
  return { maxTopLevelNodes: 1 };
}

function searchRequest() {
  return { query: 'A', caseSensitive: false, wholeWord: false, limit: 1 };
}

function searchResult(source) {
  const start = { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: 0 };
  const end = { ...start, charIndex: 1 };
  return {
    pageIndex: 0,
    spreadIndex: 0,
    matchRange: { pageIndex: 0, start, end, context: 'A' },
    source,
  };
}

function searchSource() {
  return {
    status: 'resolved',
    href: 'chapter.xhtml',
    sourceRange: {
      start: { nodePath: [1], textOffset: 2 },
      end: { nodePath: [1], textOffset: 3 },
    },
  };
}

async function openClient(worker) {
  const client = createRitoCoreWasmWorkerReaderClient(worker);
  const opening = client.open(new ArrayBuffer(0));
  await Promise.resolve();
  worker.respondLast({ kind: 'open', result: readerOpenResult({ title: 'fixture' }) });
  await opening;
  return client;
}

function unusedRawDocument() {
  throw new Error('fixture constructs the wrapped document directly');
}

class ManualWorker {
  listeners = new Map();
  messages = [];

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  postMessage(message) {
    this.messages.push(message);
  }

  terminate() {}

  respondLast(payload) {
    const { id } = this.messages.at(-1);
    this.emit('message', { data: { id, ok: true, payload } });
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
