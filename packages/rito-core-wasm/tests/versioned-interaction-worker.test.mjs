import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmDocumentRuntime } from '../dist/core-wasm-document-runtime.js';
import { createRitoCoreWasmInProcessReaderClient } from '../dist/reader-worker-client-runtime.js';
import { createRitoCoreWasmWorkerReaderClient } from '../dist/reader-worker-client-runtime.js';
import { versionedReaderWorkerPayload } from '../dist/reader-worker-versioned-payload-runtime.js';
import { pinnedFontPolicyJson, readerOpenResult } from './reader-worker-test-fixture.mjs';

const { RitoCoreWasmDocument } = createRitoCoreWasmDocumentRuntime(
  async () => {},
  unusedRawDocument,
);

test('in-process versioned interaction reads preserve exact visible-page fields', async () => {
  const calls = [];
  const document = new RitoCoreWasmDocument(rawInteractionDocument(calls));
  const client = createRitoCoreWasmInProcessReaderClient(moduleFor(document));
  await client.open(new ArrayBuffer(0));

  const targets = await client.getPageTargetsAtRevision(handle(3), 4);
  const footnote = await client.getFootnoteAtRevision(handle(3), 'Text/chapter.xhtml#fn1');
  const locator = await client.resolveLocatorAtRevision(handle(3), {
    href: 'Text/chapter.xhtml#intro',
  });
  const sourceLocator = {
    href: 'Text/chapter.xhtml',
    sourcePoint: { nodePath: [1], textOffset: 2 },
    sourceRange: {
      start: { nodePath: [1], textOffset: 2 },
      end: { nodePath: [1], textOffset: 8 },
    },
  };
  const source = await client.resolveSourceLocatorAtRevision(handle(3), sourceLocator);
  const pendingSource = await client.resolveSourceLocatorAtRevision(handle(3), {
    href: 'Text/future.xhtml',
    progression: 0.25,
  });

  assert.deepEqual(targets.revision, handle(3));
  assert.equal(targets.value.pageIndex, 4);
  assert.equal(targets.value.spreadIndex, 2);
  assert.equal(targets.value.entryCount, 1);
  assert.equal(footnote.value.key, 'Text/chapter.xhtml#fn1');
  assert.equal(locator.value.href, 'Text/chapter.xhtml#intro');
  assert.equal(locator.value.pageIndex, 4);
  assert.deepEqual(source.value.locator, sourceLocator);
  assert.equal(source.value.matchedBy, 'sourceRange');
  assert.equal(pendingSource.value.status, 'pending');
  assert.equal(pendingSource.value.reason, 'notPaginated');
  const versionedCalls = calls.filter(([name]) => name.includes('AtRevision'));
  assert.equal(versionedCalls.length, 5);
  assert.ok(versionedCalls.every(([, args]) => args[0] === 'rev-1' && args[1] === 3));
  client.dispose();
});

test('payload dispatch rejects mismatched outer and interaction-specific inner fields', () => {
  const cases = [
    {
      request: { kind: 'getPageTargetsAtRevision', revision: handle(1), pageIndex: 4 },
      document: {
        getPageTargetsAtRevision: () => ({
          revision: handle(2),
          value: pageTargets('rev-1', 4),
        }),
      },
      pattern: /mismatched versioned responses/,
    },
    {
      request: { kind: 'getFootnoteAtRevision', revision: handle(1), key: 'chapter#fn1' },
      document: {
        getFootnoteAtRevision: () => ({
          revision: handle(1),
          value: footnote('rev-1', 'chapter#other'),
        }),
      },
      pattern: /mismatched footnote key/,
    },
    {
      request: {
        kind: 'resolveLocatorAtRevision',
        revision: handle(1),
        locator: { href: 'chapter.xhtml#intro' },
      },
      document: {
        resolveLocatorAtRevision: () => ({
          revision: handle(1),
          value: resolvedLocator('rev-other', 'chapter.xhtml#intro'),
        }),
      },
      pattern: /mismatched revisionId/,
    },
    {
      request: {
        kind: 'resolveSourceLocatorAtRevision',
        revision: handle(1),
        locator: { href: 'chapter.xhtml', anchorId: 'intro' },
      },
      document: {
        resolveSourceLocatorAtRevision: () => ({
          revision: handle(1),
          value: { ...sourceLocatorResolution('rev-1'), pageIndex: -1 },
        }),
      },
      pattern: /pageIndex/,
    },
  ];

  for (const fixture of cases) {
    assert.throws(
      () => versionedReaderWorkerPayload(fixture.document, fixture.request),
      fixture.pattern,
    );
  }
});

test('worker client rejects matching envelopes with forged interaction results', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const cases = [
    {
      pending: () => client.getPageTargetsAtRevision(handle(1), 4),
      kind: 'getPageTargetsAtRevision',
      result: pageTargets('rev-other', 4),
      pattern: /mismatched revisionId/,
    },
    {
      pending: () => client.getPageTargetsAtRevision(handle(1), 4),
      kind: 'getPageTargetsAtRevision',
      result: pageTargets('rev-1', 5),
      pattern: /mismatched pageIndex/,
    },
    {
      pending: () => client.getPageTargetsAtRevision(handle(1), 4),
      kind: 'getPageTargetsAtRevision',
      result: { ...pageTargets('rev-1', 4), spreadIndex: -1 },
      pattern: /spreadIndex/,
    },
    {
      pending: () => client.getPageTargetsAtRevision(handle(1), 4),
      kind: 'getPageTargetsAtRevision',
      result: pageTargets('rev-1', 4, {
        bounds: { x: -1, y: 0, width: -20, height: 10 },
      }),
      pattern: /page target bounds.*invalid width/,
    },
    {
      pending: () => client.getPageTargetsAtRevision(handle(1), 4),
      kind: 'getPageTargetsAtRevision',
      result: pageTargets('rev-1', 4, {
        kind: 'footnote',
        footnoteKey: undefined,
      }),
      pattern: /incomplete footnote target/,
    },
    {
      pending: () => client.getPageTargetsAtRevision(handle(1), 4),
      kind: 'getPageTargetsAtRevision',
      result: pageTargets('rev-1', 4, {
        targetLocator: { href: 'chapter.xhtml', sourcePoint: { nodePath: [0, -1], textOffset: 0 } },
      }),
      pattern: /invalid source node path/,
    },
    {
      pending: () => client.getFootnoteAtRevision(handle(1), 'chapter#fn1'),
      kind: 'getFootnoteAtRevision',
      result: footnote('rev-1', 'chapter#other'),
      pattern: /mismatched footnote key/,
    },
    {
      pending: () => client.resolveLocatorAtRevision(handle(1), { href: 'chapter.xhtml#intro' }),
      kind: 'resolveLocatorAtRevision',
      result: resolvedLocator('rev-1', 'chapter.xhtml#other'),
      pattern: /mismatched locator href/,
    },
    {
      pending: () => client.resolveLocatorAtRevision(handle(1), { href: 'chapter.xhtml#intro' }),
      kind: 'resolveLocatorAtRevision',
      result: { ...resolvedLocator('rev-1', 'chapter.xhtml#intro'), fragment: 'other' },
      pattern: /mismatched locator fragment/,
    },
    {
      pending: () =>
        client.resolveSourceLocatorAtRevision(handle(1), {
          href: 'chapter.xhtml',
          sourcePoint: { nodePath: [0], textOffset: 1 },
        }),
      kind: 'resolveSourceLocatorAtRevision',
      result: { ...sourceLocatorResolution('rev-1'), matchedBy: 'guess' },
      pattern: /invalid source locator match kind/,
    },
  ];

  for (const fixture of cases) {
    const pending = fixture.pending();
    worker.respondLast({ kind: fixture.kind, revision: handle(1), result: fixture.result });
    await assert.rejects(pending, fixture.pattern);
  }
  client.dispose();
});

function rawInteractionDocument(calls) {
  return new Proxy(
    {
      publicationJson: () => JSON.stringify({ title: 'fixture' }),
      pinnedFontPolicyJson,
      free() {},
      getPageTargetsAtRevisionJson: (_revisionId, version, pageIndex) =>
        envelope(version, pageTargets('rev-1', pageIndex)),
      getFootnoteAtRevisionJson: (_revisionId, version, key) =>
        envelope(version, footnote('rev-1', key)),
      resolveLocatorAtRevisionJson: (_revisionId, version, requestJson) =>
        envelope(version, resolvedLocator('rev-1', JSON.parse(requestJson).href)),
      resolveSourceLocatorAtRevisionJson: (_revisionId, version, requestJson) => {
        const locator = JSON.parse(requestJson);
        return envelope(
          version,
          locator.href === 'Text/future.xhtml'
            ? pendingSourceLocatorResolution('rev-1', locator)
            : sourceLocatorResolution('rev-1', locator),
        );
      },
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
}

function pageTargets(revisionId, pageIndex, overrides = {}) {
  return {
    revisionId,
    pageIndex,
    spreadIndex: 2,
    entryCount: 1,
    textHash: 'hash',
    entries: [pageTarget(overrides)],
  };
}

function pageTarget(overrides = {}) {
  return {
    kind: 'link',
    bounds: { x: 1, y: 2, width: 20, height: 10 },
    blockIndex: 0,
    lineIndex: 0,
    runIndex: 0,
    label: 'intro',
    text: { hash: 'text-hash', length: 5 },
    href: '#intro',
    targetLocator: { href: 'Text/chapter.xhtml', anchorId: 'intro' },
    ...overrides,
  };
}

function footnote(revisionId, key) {
  return { revisionId, key, kind: 'footnote', text: 'note', html: '<p>note</p>' };
}

function resolvedLocator(revisionId, href) {
  const hashIndex = href.indexOf('#');
  return {
    revisionId,
    href,
    spineIdref: 'chapter',
    pageIndex: 4,
    spreadIndex: 2,
    ...(hashIndex < 0 ? {} : { fragment: href.slice(hashIndex + 1) }),
  };
}

function sourceLocatorResolution(
  revisionId,
  locator = {
    href: 'chapter.xhtml',
    sourcePoint: { nodePath: [0], textOffset: 1 },
  },
) {
  return {
    status: 'resolved',
    revisionId,
    locator,
    spineIdref: 'chapter',
    pageIndex: 4,
    spreadIndex: 2,
    matchedBy: locator.sourceRange ? 'sourceRange' : 'sourcePoint',
  };
}

function pendingSourceLocatorResolution(revisionId, locator) {
  return {
    status: 'pending',
    revisionId,
    locator,
    spineIdref: 'future',
    reason: 'notPaginated',
    matchedBy: 'progression',
  };
}

function envelope(version, value) {
  return JSON.stringify({ revision: handle(version), value });
}

function handle(revisionVersion) {
  return { revisionId: 'rev-1', revisionVersion };
}

function moduleFor(document) {
  return { initRitoCoreWasmEngine: async () => ({ openDocument: () => document }) };
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
    for (const listener of this.listeners.get('message') ?? []) {
      listener({ data: { id, ok: true, payload } });
    }
  }
}
