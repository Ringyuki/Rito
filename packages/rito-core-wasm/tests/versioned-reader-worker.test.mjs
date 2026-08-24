import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmDocumentRuntime } from '../dist/core-wasm-document-runtime.js';
import { RitoCoreWasmError } from '../dist/core-wasm-error-runtime.js';
import {
  createRitoCoreWasmInProcessReaderClient,
  createRitoCoreWasmReaderWorkerHandler,
  createRitoCoreWasmWorkerReaderClient,
} from '../dist/reader-worker-client-runtime.js';
import { pinnedFontPolicyJson, readerOpenResult } from './reader-worker-test-fixture.mjs';

const { RitoCoreWasmDocument } = createRitoCoreWasmDocumentRuntime(
  async () => {},
  unusedRawDocument,
);

test('in-process bounded worker primitives preserve exact revision handles', async () => {
  const { document, calls } = fixtureDocument();
  const client = createRitoCoreWasmInProcessReaderClient(moduleFor(document));
  await client.open(new ArrayBuffer(0));

  const created = await client.createBoundedRevision({ layoutConfig: {}, budget: budget() });
  assert.deepEqual(created.revision, handle(0));
  const continued = await client.continueRevision({
    ...created.revision,
    cursor: created.value.continuation.cursor,
    budget: budget(),
  });
  assert.deepEqual(continued.revision, handle(1));

  const summaryResult = await client.getRevisionSummaryAtRevision(handle(1));
  const bundleResult = await client.getRevisionBundleAtRevision(handle(1), true);
  const presentationResult = await client.getRevisionPresentationAtRevision(handle(1));
  const shapeDiagnosticResult = await client.getShapeProvenanceDiagnosticAtRevision(handle(1));
  const navigation = await client.getRevisionNavigationAtRevision(handle(1));
  const frame = await client.readFrameBufferAtRevision(handle(1), 0);
  const resource = await client.readResourceAtRevision(handle(1), 'image', 'cover.png');
  const source = await client.resolveSourceLocatorAtRevision(handle(1), {
    href: 'chapter.xhtml',
  });
  const footnotes = await client.getFootnotesAtRevision(handle(1));
  const chapterTextIndices = await client.getChapterTextIndicesAtRevision(handle(1));
  const search = await client.searchAtRevision(handle(1), searchRequest());
  const transferRelease = await client.releaseRevisionTransfersAtRevision(handle(1));
  const revisionRelease = await client.releaseRevisionAtRevision(handle(1));

  for (const result of [
    summaryResult,
    bundleResult,
    presentationResult,
    shapeDiagnosticResult,
    navigation,
    frame,
    resource,
    source,
    footnotes,
    chapterTextIndices,
    search,
    transferRelease,
    revisionRelease,
  ]) {
    assert.deepEqual(result.revision, handle(1));
  }
  assert.deepEqual(frame.value.bytes, Uint8Array.of(4, 5));
  assert.deepEqual(resource.value.bytes, Uint8Array.of(6, 7, 8));
  assert.equal(bundleResult.value.chapterTextIndices.entries['chapter.xhtml'].normalizedText, 'A');
  assert.equal('chapterTextIndices' in presentationResult.value, false);
  assert.equal('footnotes' in presentationResult.value, false);
  assert.equal(search.value.query, 'A');
  assert.ok(
    calls.some(([name, args]) => name === 'getRevisionBundleAtRevisionJson' && args[2] === true),
  );
  assert.ok(calls.some(([name, args]) => name === 'releaseRevisionAtRevision' && args[1] === 1));
  client.dispose();
});

test('in-process continuation releases predecessor transfers inside one dispatch', async () => {
  const { document, calls } = fixtureDocument();
  const client = createRitoCoreWasmInProcessReaderClient(moduleFor(document));
  await client.open(new ArrayBuffer(0));

  const continued = await client.continueRevisionAfterTransferRelease({
    ...handle(0),
    cursor: 'cursor-1',
    budget: budget(),
  });

  assert.deepEqual(continued.revision, handle(1));
  assert.deepEqual(continued.value.advance, advance(1, false));
  assert.deepEqual(continued.value.releasedRevision, handle(0));
  assert.equal(continued.value.releasedTransferCount, 1);
  assert.deepEqual(
    calls
      .filter(([name]) =>
        ['releaseRevisionTransfersAtRevision', 'continueRevisionJson'].includes(name),
      )
      .map(([name]) => name),
    ['continueRevisionJson', 'releaseRevisionTransfersAtRevision'],
  );
  client.dispose();
});

test('in-process atomic continuation batches native quanta and aggregates the advance', async () => {
  const continuedVersions = [];
  const releasedVersions = [];
  const document = new RitoCoreWasmDocument({
    publicationJson: () => JSON.stringify({ title: 'fixture' }),
    pinnedFontPolicyJson,
    free() {},
    continueRevisionJson: (requestJson) => {
      const request = JSON.parse(requestJson);
      const version = request.revisionVersion + 1;
      continuedVersions.push(version);
      return JSON.stringify(growingAdvance(version));
    },
    releaseRevisionTransfersAtRevision: (_revisionId, version) => {
      releasedVersions.push(version);
      return envelope(version, 1);
    },
  });
  const client = createRitoCoreWasmInProcessReaderClient(moduleFor(document));
  await client.open(new ArrayBuffer(0));

  const continued = await client.continueRevisionAfterTransferRelease({
    ...handle(0),
    cursor: 'cursor-0',
    budget: budget(),
    maxQuanta: 8,
  });

  assert.deepEqual(continued.revision, handle(8));
  assert.equal(continued.value.advancedQuanta, 8);
  assert.equal(continued.value.releasedTransferCount, 8);
  assert.deepEqual(continued.value.releasedRevision, handle(0));
  assert.deepEqual(continued.value.advance.previousKnownExtent, extent(0));
  assert.deepEqual(continued.value.advance.newlyKnownPages, {
    startPage: 0,
    endPageExclusive: 8,
  });
  assert.equal(continued.value.advance.processedTopLevelNodes, 8);
  assert.equal(continued.value.advance.continuation.cursor, 'cursor-8');
  assert.deepEqual(continuedVersions, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(releasedVersions, [0, 1, 2, 3, 4, 5, 6, 7]);
  client.dispose();
});

test('in-process locator continuation stops its batch as soon as the locator resolves', async () => {
  const continuedVersions = [];
  const locator = { href: 'chapter.xhtml' };
  const document = new RitoCoreWasmDocument({
    publicationJson: () => JSON.stringify({ title: 'fixture' }),
    pinnedFontPolicyJson,
    free() {},
    continueRevisionTowardSourceLocatorJson: (requestJson) => {
      const request = JSON.parse(requestJson);
      const version = request.revisionVersion + 1;
      continuedVersions.push(version);
      return JSON.stringify({
        advance: growingAdvance(version),
        releasedRevision: handle(request.revisionVersion),
        releasedTransferCount: 1,
        request: request.locator,
        canonicalRequest: request.locator,
        locatorOutcome: {
          kind: 'resolved',
          resolution: growingSourceResolution(version, request.locator),
        },
      });
    },
  });
  const client = createRitoCoreWasmInProcessReaderClient(moduleFor(document));
  await client.open(new ArrayBuffer(0));

  const continued = await client.continueRevisionTowardSourceLocator({
    ...handle(0),
    cursor: 'cursor-0',
    budget: budget(),
    locator,
    maxQuanta: 8,
  });

  assert.deepEqual(continued.revision, handle(4));
  assert.equal(continued.value.advancedQuanta, 4);
  assert.equal(continued.value.releasedTransferCount, 4);
  assert.deepEqual(continued.value.advance.previousKnownExtent, extent(0));
  assert.equal(continued.value.advance.processedTopLevelNodes, 4);
  assert.equal(continued.value.locatorOutcome.resolution.status, 'resolved');
  assert.deepEqual(continuedVersions, [1, 2, 3, 4]);
  client.dispose();
});

test('in-process atomic continuation does not release transfers when continuation rejects', async () => {
  const calls = [];
  const document = new RitoCoreWasmDocument({
    publicationJson: () => JSON.stringify({ title: 'fixture' }),
    pinnedFontPolicyJson,
    free() {},
    continueRevisionJson: () => {
      calls.push('continueRevisionJson');
      throw new Error('forged continuation cursor');
    },
    releaseRevisionTransfersAtRevision: () => {
      calls.push('releaseRevisionTransfersAtRevision');
      return envelope(0, 1);
    },
  });
  const client = createRitoCoreWasmInProcessReaderClient(moduleFor(document));
  await client.open(new ArrayBuffer(0));

  await assert.rejects(
    client.continueRevisionAfterTransferRelease({
      ...handle(0),
      cursor: 'forged-cursor',
      budget: budget(),
    }),
    /forged continuation cursor/,
  );

  assert.deepEqual(calls, ['continueRevisionJson']);
  client.dispose();
});

test('in-process atomic continuation releases predecessor transfers after a committed failure', async () => {
  const calls = [];
  const failedRevision = summary(1, 'failed');
  const document = new RitoCoreWasmDocument({
    publicationJson: () => JSON.stringify({ title: 'fixture' }),
    pinnedFontPolicyJson,
    free() {},
    continueRevisionJson: () => {
      calls.push('continueRevisionJson');
      throw new Error(
        JSON.stringify({
          code: 'engine-error',
          message: 'layout failed',
          revision: failedRevision,
        }),
      );
    },
    releaseRevisionTransfersAtRevision: (_revisionId, version) => {
      calls.push('releaseRevisionTransfersAtRevision');
      return envelope(version, 1);
    },
  });
  const client = createRitoCoreWasmInProcessReaderClient(moduleFor(document));
  await client.open(new ArrayBuffer(0));

  await assert.rejects(
    client.continueRevisionAfterTransferRelease({
      ...handle(0),
      cursor: 'cursor-1',
      budget: budget(),
    }),
    (error) => {
      assert.deepEqual(error.revision, failedRevision);
      return true;
    },
  );

  assert.deepEqual(calls, ['continueRevisionJson', 'releaseRevisionTransfersAtRevision']);
  client.dispose();
});

test('in-process atomic continuation rolls back the committed revision when transfer release validation fails', async () => {
  const calls = [];
  const document = new RitoCoreWasmDocument({
    publicationJson: () => JSON.stringify({ title: 'fixture' }),
    pinnedFontPolicyJson,
    free() {},
    continueRevisionJson: () => {
      calls.push(['continueRevisionJson', 1]);
      return JSON.stringify(advance(1, false));
    },
    releaseRevisionTransfersAtRevision: () => {
      calls.push(['releaseRevisionTransfersAtRevision', 0]);
      return envelope(99, 1);
    },
    releaseRevisionAtRevision: (_revisionId, version) => {
      calls.push(['releaseRevisionAtRevision', version]);
      return envelope(version, { releasedRevision: true, releasedTransferCount: 0 });
    },
  });
  const client = createRitoCoreWasmInProcessReaderClient(moduleFor(document));
  await client.open(new ArrayBuffer(0));

  await assert.rejects(
    client.continueRevisionAfterTransferRelease({
      ...handle(0),
      cursor: 'cursor-1',
      budget: budget(),
    }),
    /mismatched revision handle/,
  );

  assert.deepEqual(calls, [
    ['continueRevisionJson', 1],
    ['releaseRevisionTransfersAtRevision', 0],
    ['releaseRevisionAtRevision', 1],
  ]);
  client.dispose();
});

test('in-process locator continuation returns the next exact locator projection', async () => {
  const { document, calls } = fixtureDocument();
  const client = createRitoCoreWasmInProcessReaderClient(moduleFor(document));
  await client.open(new ArrayBuffer(0));
  const locator = { href: 'chapter.xhtml' };

  const continued = await client.continueRevisionTowardSourceLocator({
    ...handle(0),
    cursor: 'cursor-1',
    budget: budget(),
    locator,
  });

  assert.deepEqual(continued.revision, handle(1));
  assert.deepEqual(continued.value.releasedRevision, handle(0));
  assert.deepEqual(continued.value.canonicalRequest, locator);
  assert.equal(continued.value.locatorOutcome.kind, 'resolved');
  assert.equal(continued.value.locatorOutcome.resolution.status, 'resolved');
  assert.deepEqual(
    calls
      .filter(([name]) => ['continueRevisionTowardSourceLocatorJson'].includes(name))
      .map(([name]) => name),
    ['continueRevisionTowardSourceLocatorJson'],
  );
  client.dispose();
});

test('worker client sends atomic transfer release and continuation as one request', async () => {
  const worker = new ManualWorker();
  const client = createRitoCoreWasmWorkerReaderClient(worker);
  const opening = client.open(new ArrayBuffer(0));
  await Promise.resolve();
  worker.respond(worker.messages[0].id, {
    kind: 'open',
    result: readerOpenResult({ title: 'fixture' }),
  });
  await opening;

  const messageCount = worker.messages.length;
  const pending = client.continueRevisionAfterTransferRelease({
    ...handle(0),
    cursor: 'cursor-1',
    budget: budget(),
  });
  const request = worker.messages.at(-1);
  assert.equal(worker.messages.length, messageCount + 1);
  assert.equal(request.kind, 'continueRevisionAfterTransferRelease');
  worker.respond(request.id, {
    kind: request.kind,
    revision: handle(1),
    result: {
      advance: advance(1, false),
      releasedRevision: handle(0),
      releasedTransferCount: 2,
    },
  });

  const continued = await pending;
  assert.deepEqual(continued.revision, handle(1));
  assert.equal(continued.value.releasedTransferCount, 2);
  client.dispose();
});

test('worker client advances toward a locator with one request per quantum', async () => {
  const worker = new ManualWorker();
  const client = createRitoCoreWasmWorkerReaderClient(worker);
  const opening = client.open(new ArrayBuffer(0));
  await Promise.resolve();
  worker.respond(worker.messages[0].id, {
    kind: 'open',
    result: readerOpenResult({ title: 'fixture' }),
  });
  await opening;
  const locator = { href: 'chapter.xhtml#' };
  const canonicalLocator = { href: 'chapter.xhtml' };

  const messageCount = worker.messages.length;
  const pending = client.continueRevisionTowardSourceLocator({
    ...handle(0),
    cursor: 'cursor-1',
    budget: budget(),
    locator,
  });
  const request = worker.messages.at(-1);
  assert.equal(worker.messages.length, messageCount + 1);
  assert.equal(request.kind, 'continueRevisionTowardSourceLocator');
  worker.respond(request.id, {
    kind: request.kind,
    revision: handle(1),
    result: {
      advance: advance(1, false),
      releasedRevision: handle(0),
      releasedTransferCount: 1,
      request: locator,
      canonicalRequest: canonicalLocator,
      locatorOutcome: { kind: 'resolved', resolution: sourceResolution(1, canonicalLocator) },
    },
  });

  const continued = await pending;
  assert.equal(continued.value.locatorOutcome.kind, 'resolved');
  assert.deepEqual(continued.value.request, locator);
  assert.deepEqual(continued.value.canonicalRequest, canonicalLocator);
  client.dispose();
});

test('in-process exact bundle reads reject a stale raw revision envelope', async () => {
  const document = new RitoCoreWasmDocument({
    publicationJson: () => JSON.stringify({ title: 'fixture' }),
    pinnedFontPolicyJson,
    free() {},
    getRevisionBundleAtRevisionJson: () =>
      JSON.stringify({ revision: handle(2), value: bundle(2) }),
  });
  const client = createRitoCoreWasmInProcessReaderClient(moduleFor(document));
  await client.open(new ArrayBuffer(0));

  await assert.rejects(
    client.getRevisionBundleAtRevision(handle(1), true),
    /mismatched revision handle/,
  );
  client.dispose();
});

test('real worker handler uses the same bounded dispatch and transfers versioned bytes', async () => {
  const { document, calls } = fixtureDocument();
  const scope = new HandlerScope();
  createRitoCoreWasmReaderWorkerHandler(scope, {
    initRitoCoreWasmEngine: async () => ({ openDocument: () => document }),
    normalizeRitoCoreWasmError: normalizeError,
  });
  assert.equal((await scope.send({ id: 1, kind: 'open', data: new ArrayBuffer(0) })).ok, true);
  const created = await scope.send({
    id: 2,
    kind: 'createBoundedRevision',
    request: { layoutConfig: {}, budget: budget() },
  });
  assert.equal(created.ok, true);
  assert.deepEqual(created.payload.revision, handle(0));

  const frame = await scope.send({
    id: 3,
    kind: 'readFrameBufferAtRevision',
    revision: handle(0),
    spreadIndex: 0,
  });
  assert.equal(frame.ok, true);
  assert.deepEqual(frame.payload.revision, handle(0));
  assert.deepEqual(scope.transfers.at(-1), [frame.payload.result.bytes.buffer]);

  const bundle = await scope.send({
    id: 4,
    kind: 'getRevisionBundleAtRevision',
    revision: handle(0),
    includeTocTargets: true,
  });
  assert.equal(bundle.ok, true);
  assert.deepEqual(bundle.payload.revision, handle(0));
  assert.equal(
    bundle.payload.result.chapterTextIndices.entries['chapter.xhtml'].normalizedText,
    'A',
  );
  assert.ok(
    calls.some(([name, args]) => name === 'getRevisionBundleAtRevisionJson' && args[2] === true),
  );

  const presentationResult = await scope.send({
    id: 8,
    kind: 'getRevisionPresentationAtRevision',
    revision: handle(0),
  });
  assert.equal(presentationResult.ok, true);
  assert.deepEqual(presentationResult.payload.revision, handle(0));
  assert.equal('chapterTextIndices' in presentationResult.payload.result, false);
  assert.equal('footnotes' in presentationResult.payload.result, false);

  const footnotes = await scope.send({
    id: 5,
    kind: 'getFootnotesAtRevision',
    revision: handle(0),
  });
  const indices = await scope.send({
    id: 6,
    kind: 'getChapterTextIndicesAtRevision',
    revision: handle(0),
  });
  const search = await scope.send({
    id: 7,
    kind: 'searchAtRevision',
    revision: handle(0),
    request: searchRequest(),
  });
  assert.equal(footnotes.ok, true);
  assert.equal(indices.ok, true);
  assert.equal(search.ok, true);
  assert.deepEqual(search.payload.result, searchResponse(searchRequest()));
});

test('worker exact revision reads reject forged handles and embedded identities', async () => {
  const worker = new ManualWorker();
  const client = createRitoCoreWasmWorkerReaderClient(worker);
  const opening = client.open(new ArrayBuffer(0));
  await Promise.resolve();
  worker.respond(worker.messages[0].id, {
    kind: 'open',
    result: readerOpenResult({ title: 'fixture' }),
  });
  await opening;

  const bundled = client.getRevisionBundleAtRevision(handle(1), true);
  const bundleMessage = worker.messages.at(-1);
  assert.equal(bundleMessage.includeTocTargets, true);
  worker.respond(bundleMessage.id, {
    kind: 'getRevisionBundleAtRevision',
    revision: handle(1),
    result: bundle(1),
  });
  assert.deepEqual((await bundled).value.chapterTextIndices, chapterTextIndices());

  const presented = client.getRevisionPresentationAtRevision(handle(1));
  const presentationMessage = worker.messages.at(-1);
  worker.respond(presentationMessage.id, {
    kind: 'getRevisionPresentationAtRevision',
    revision: handle(1),
    result: presentation(1),
  });
  assert.deepEqual((await presented).value, presentation(1));

  const stale = client.getRevisionBundleAtRevision(handle(1));
  worker.respond(worker.messages.at(-1).id, {
    kind: 'getRevisionBundleAtRevision',
    revision: handle(2),
    result: bundle(2),
  });
  await assert.rejects(stale, /mismatched revision handle/);

  const forgedBundle = client.getRevisionBundleAtRevision(handle(1));
  worker.respond(worker.messages.at(-1).id, {
    kind: 'getRevisionBundleAtRevision',
    revision: handle(1),
    result: bundle(2),
  });
  await assert.rejects(forgedBundle, /non-sequential revisionVersion/);

  const forgedFootnotes = client.getFootnotesAtRevision(handle(1));
  worker.respond(worker.messages.at(-1).id, {
    kind: 'getFootnotesAtRevision',
    revision: handle(1),
    result: { revisionId: 'rev-other', complete: true, pendingKeys: [], entries: {} },
  });
  await assert.rejects(forgedFootnotes, /mismatched revisionId/);

  const forgedIndices = client.getChapterTextIndicesAtRevision(handle(1));
  worker.respond(worker.messages.at(-1).id, {
    kind: 'getChapterTextIndicesAtRevision',
    revision: handle(1),
    result: {
      ...chapterTextIndices(),
      entries: {
        'chapter.xhtml': {
          ...chapterTextIndices().entries['chapter.xhtml'],
          spans: [{ nodePath: [-1] }],
        },
      },
    },
  });
  await assert.rejects(forgedIndices, /invalid chapter text node path/);

  const forgedSearch = client.searchAtRevision(handle(1), searchRequest());
  worker.respond(worker.messages.at(-1).id, {
    kind: 'searchAtRevision',
    revision: handle(1),
    result: { ...searchResponse(searchRequest()), query: 'forged' },
  });
  await assert.rejects(forgedSearch, /mismatched query/);
  client.dispose();
});

test('worker client rejects cross-version races even when responses arrive out of order', async () => {
  const worker = new ManualWorker();
  const client = createRitoCoreWasmWorkerReaderClient(worker);
  const opening = client.open(new ArrayBuffer(0));
  await Promise.resolve();
  worker.respond(worker.messages[0].id, {
    kind: 'open',
    result: readerOpenResult({ title: 'fixture' }),
  });
  await opening;

  const first = client.getRevisionSummaryAtRevision(handle(1));
  const second = client.getRevisionSummaryAtRevision(handle(2));
  const [firstMessage, secondMessage] = worker.messages.slice(-2);
  worker.respond(secondMessage.id, versionedPayload('getRevisionSummaryAtRevision', 2));
  worker.respond(firstMessage.id, versionedPayload('getRevisionSummaryAtRevision', 1));
  assert.deepEqual((await first).revision, handle(1));
  assert.deepEqual((await second).revision, handle(2));

  const raced = client.getRevisionSummaryAtRevision(handle(2));
  worker.respond(worker.messages.at(-1).id, versionedPayload('getRevisionSummaryAtRevision', 3));
  await assert.rejects(raced, /mismatched revision handle/);
  client.dispose();
});

test('failed revision recovery state survives the worker error round trip', async () => {
  const worker = new ManualWorker();
  const client = createRitoCoreWasmWorkerReaderClient(worker);
  const opening = client.open(new ArrayBuffer(0));
  await Promise.resolve();
  worker.respond(worker.messages[0].id, {
    kind: 'open',
    result: readerOpenResult({ title: 'fixture' }),
  });
  await opening;

  const continuing = client.continueRevision({
    ...handle(1),
    cursor: 'cursor-2',
    budget: budget(),
  });
  const failedRevision = summary(2, 'failed');
  worker.fail(worker.messages.at(-1).id, {
    name: 'RitoCoreWasmError',
    message: 'layout failed',
    code: 'engine-error',
    revision: failedRevision,
  });

  await assert.rejects(continuing, (error) => {
    assert.ok(error instanceof RitoCoreWasmError);
    assert.equal(error.code, 'engine-error');
    assert.deepEqual(error.revision, failedRevision);
    return true;
  });
  client.dispose();
});

function fixtureDocument() {
  const calls = [];
  const transferId = 'transfer-1';
  const raw = new Proxy(
    {
      publicationJson: () => JSON.stringify({ title: 'fixture' }),
      pinnedFontPolicyJson,
      free() {},
      createBoundedRevisionJson: () => JSON.stringify(advance(0, true)),
      continueRevisionJson: () => JSON.stringify(advance(1, false)),
      continueRevisionTowardSourceLocatorJson: (requestJson) => {
        const request = JSON.parse(requestJson);
        return JSON.stringify({
          advance: advance(1, false),
          releasedRevision: handle(0),
          releasedTransferCount: 1,
          request: request.locator,
          canonicalRequest: request.locator,
          locatorOutcome: {
            kind: 'resolved',
            resolution: sourceResolution(1, request.locator),
          },
        });
      },
      getRevisionSummaryAtRevisionJson: (_revisionId, version) =>
        envelope(version, summary(version, 'complete')),
      getRevisionBundleAtRevisionJson: (_revisionId, version) =>
        envelope(version, bundle(version, 'complete')),
      getRevisionPresentationAtRevisionJson: (_revisionId, version) =>
        envelope(version, presentation(version, 'complete')),
      getShapeProvenanceDiagnosticAtRevisionJson: (_revisionId, version) =>
        envelope(version, shapeDiagnostic()),
      getRevisionNavigationAtRevisionJson: (_revisionId, version) =>
        envelope(version, { revisionId: 'rev-1' }),
      getFootnotesAtRevisionJson: (_revisionId, version) =>
        envelope(version, { revisionId: 'rev-1', complete: true, pendingKeys: [], entries: {} }),
      getChapterTextIndicesAtRevisionJson: (_revisionId, version) =>
        envelope(version, chapterTextIndices()),
      searchAtRevisionJson: (_revisionId, version, requestJson) =>
        envelope(version, searchResponse(JSON.parse(requestJson))),
      getFrameCommandBufferMetadataAtRevisionJson: (_revisionId, version) =>
        envelope(version, { revisionId: 'rev-1', spreadIndex: 0, byteLength: 2 }),
      readFrameCommandBufferAtRevision: () => Uint8Array.of(4, 5),
      getResourcePayloadAtRevisionJson: (_revisionId, version) =>
        envelope(version, {
          revisionId: 'rev-1',
          transferId,
          kind: 'image',
          href: 'cover.png',
          mediaType: 'image/png',
          byteLength: 3,
        }),
      takeResourceTransfer: () => Uint8Array.of(6, 7, 8),
      releaseResourceTransfer: () => true,
      resolveSourceLocatorAtRevisionJson: (_revisionId, version, locatorJson) =>
        envelope(version, sourceResolution(version, JSON.parse(locatorJson))),
      releaseRevisionTransfersAtRevision: (_revisionId, version) => envelope(version, 1),
      releaseRevisionAtRevision: (_revisionId, version) =>
        envelope(version, { releasedRevision: true, releasedTransferCount: 0 }),
    },
    {
      get(target, property) {
        const value = target[property];
        if (typeof value !== 'function') return value;
        return (...args) => {
          calls.push([property, args]);
          return value(...args);
        };
      },
    },
  );
  return { calls, document: new RitoCoreWasmDocument(raw) };
}

function moduleFor(document) {
  return { initRitoCoreWasmEngine: async () => ({ openDocument: () => document }) };
}

function shapeDiagnostic() {
  return {
    schemaVersion: 1,
    isComplete: true,
    knownPageCount: 1,
    totalTextRuns: 1,
    exactTextRuns: 0,
    unavailableTextRuns: 1,
    totalTextUtf16CodeUnitCount: 1,
    exactTextUtf16CodeUnitCount: 0,
    unavailableTextUtf16CodeUnitCount: 1,
    excludedRubyTextRunCount: 0,
    excludedRubyTextUtf16CodeUnitCount: 0,
    singleFontTextRuns: 0,
    mixedFontTextRuns: 0,
    unavailableReasonCounts: { hostMetricsFallback: 1 },
    unavailableReasonUtf16CodeUnitCounts: { hostMetricsFallback: 1 },
    singleFontFingerprints: {},
    mixedFontFingerprints: {},
    unavailableAffectedCodepoints: [
      { codepoint: 'U+0041', count: 1, reasonCounts: { hostMetricsFallback: 1 } },
    ],
    unavailableAffectedCodepointOccurrenceCount: 1,
    unavailableAffectedCodepointDistinctCount: 1,
    unavailableAffectedCodepointOmittedCount: 0,
  };
}

function versionedPayload(kind, version) {
  return { kind, revision: handle(version), result: summary(version, 'ready') };
}

function bundle(version, status = 'ready') {
  const revisionId = 'rev-1';
  return {
    revision: summary(version, status),
    navigation: { revisionId, pageCount: 1, spreadCount: 1 },
    tocTargets: { revisionId, targets: [] },
    footnotes: { revisionId, complete: true, pendingKeys: [], entries: {} },
    chapterTextIndices: chapterTextIndices(),
    fontFamilies: [],
  };
}

function presentation(version, status = 'ready') {
  const revisionId = 'rev-1';
  return {
    revision: summary(version, status),
    navigation: {
      revisionId,
      pageCount: 1,
      spreadCount: 1,
      spreads: [{ spreadIndex: 0, pageIndexes: [0], leftPageIndex: 0 }],
      chapters: [],
      chapterMap: {},
    },
    tocTargets: { revisionId, targets: [] },
    fontFamilies: [],
  };
}

function chapterTextIndices() {
  return {
    revisionId: 'rev-1',
    entries: {
      'chapter.xhtml': {
        href: 'chapter.xhtml',
        normalizedText: 'A',
        spans: [
          {
            nodePath: [0],
            sourceStart: 0,
            sourceEnd: 1,
            normalizedStart: 0,
            normalizedEnd: 1,
          },
        ],
      },
    },
  };
}

function searchRequest() {
  return { query: 'A', caseSensitive: true, wholeWord: false, limit: 1 };
}

function searchResponse(request) {
  return { revisionId: 'rev-1', ...request, resultCount: 0, results: [] };
}

function sourceResolution(version, locator) {
  if (version === 0) {
    return {
      status: 'pending',
      revisionId: 'rev-1',
      locator,
      spineIdref: 'chapter',
      reason: 'notPaginated',
      matchedBy: 'href',
    };
  }
  return {
    status: 'resolved',
    revisionId: 'rev-1',
    locator,
    spineIdref: 'chapter',
    pageIndex: 0,
    spreadIndex: 0,
    matchedBy: 'href',
  };
}

function envelope(version, value) {
  return JSON.stringify({ revision: handle(version), value });
}

function advance(version, continuing) {
  return {
    revision: summary(version, continuing ? 'ready' : 'complete'),
    previousKnownExtent: { pageCount: 0, spreadCount: 0 },
    newlyKnownPages: { startPage: 0, endPageExclusive: 1 },
    processedTopLevelNodes: 1,
    ...(continuing ? { continuation: { ...handle(version), cursor: 'cursor-1' } } : {}),
  };
}

function growingAdvance(version) {
  const previousKnownExtent = extent(version - 1);
  const knownExtent = extent(version);
  return {
    revision: growingSummary(version, knownExtent),
    previousKnownExtent,
    newlyKnownPages: {
      startPage: previousKnownExtent.pageCount,
      endPageExclusive: knownExtent.pageCount,
    },
    processedTopLevelNodes: 1,
    continuation: { ...handle(version), cursor: `cursor-${String(version)}` },
  };
}

function growingSummary(version, knownExtent) {
  return {
    ...handle(version),
    layoutKey: 'layout',
    status: 'ready',
    knownExtent,
    pageCount: knownExtent.pageCount,
    spreadCount: knownExtent.spreadCount,
  };
}

function growingSourceResolution(version, locator) {
  if (version < 4) {
    return {
      status: 'pending',
      revisionId: 'rev-1',
      locator,
      spineIdref: 'chapter',
      reason: 'notPaginated',
      matchedBy: 'href',
    };
  }
  return {
    status: 'resolved',
    revisionId: 'rev-1',
    locator,
    spineIdref: 'chapter',
    pageIndex: 3,
    spreadIndex: 3,
    matchedBy: 'href',
  };
}

function extent(count) {
  return { pageCount: count, spreadCount: count };
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

function handle(revisionVersion) {
  return { revisionId: 'rev-1', revisionVersion };
}

function budget() {
  return { maxTopLevelNodes: 1 };
}

function normalizeError(error) {
  return error instanceof Error ? error : new Error(String(error));
}

function unusedRawDocument() {
  throw new Error('fixture constructs the wrapped document directly');
}

class HandlerScope {
  pending = new Map();
  transfers = [];

  addEventListener(_type, listener) {
    this.listener = listener;
  }

  postMessage(message, transfer = []) {
    this.transfers.push(transfer);
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

  respond(id, payload) {
    this.emit('message', { data: { id, ok: true, payload } });
  }

  fail(id, error) {
    this.emit('message', { data: { id, ok: false, error } });
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
