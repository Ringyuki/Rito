import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createRitoCoreWasmInProcessReaderClient,
  createRitoCoreWasmWorkerReaderClient,
} from '../dist/reader-worker-client-runtime.js';

const FULL_SCOPE_KEY = 'chapter-text-v1:full';
const CHAPTER_ENTRIES = {
  'chapter.xhtml': {
    href: 'chapter.xhtml',
    normalizedText: 'cached text',
    spans: [],
  },
};
const VIEW_REQUEST = {
  mode: 'full',
  activeSpreadIndex: 0,
  layoutConfig: { pageWidth: 320, pageHeight: 480 },
};

test('full chapter text indices hydrate from a cache shared across reader clients', async () => {
  const cache = {};
  const firstRequests = [];
  const first = createRitoCoreWasmInProcessReaderClient(
    fakeModule((request) => {
      firstRequests.push(request);
      return viewPayload({
        revisionId: 'revision-1',
        entries: chapterEntries(),
        scopeKey: FULL_SCOPE_KEY,
      });
    }),
    cache,
  );
  await first.open(new ArrayBuffer(0));
  const inline = await first.createViewRevision(VIEW_REQUEST);
  first.dispose();

  assert.equal(firstRequests[0].knownFullChapterTextIndicesScopeKey, undefined);
  assert.deepEqual(inline.result.bundle.chapterTextIndices, {
    revisionId: 'revision-1',
    entries: CHAPTER_ENTRIES,
  });
  assert.equal(Object.hasOwn(inline.result.bundle.chapterTextIndices, 'scopeKey'), false);
  inline.result.bundle.chapterTextIndices.entries['chapter.xhtml'].normalizedText = 'mutated';

  const worker = new RespondingWorker((request) => {
    assert.equal(request.knownFullChapterTextIndicesScopeKey, FULL_SCOPE_KEY);
    return viewPayload({ revisionId: 'revision-2', scopeKey: FULL_SCOPE_KEY });
  });
  const second = createRitoCoreWasmWorkerReaderClient(worker, cache);
  await second.open(new ArrayBuffer(0));
  const hydrated = await second.createViewRevision(VIEW_REQUEST);
  second.dispose();

  assert.deepEqual(hydrated.result.bundle.chapterTextIndices, {
    revisionId: 'revision-2',
    entries: CHAPTER_ENTRIES,
  });
  assert.notEqual(
    hydrated.result.bundle.chapterTextIndices.entries,
    inline.result.bundle.chapterTextIndices.entries,
  );
  assert.equal(Object.hasOwn(hydrated.result.bundle.chapterTextIndices, 'scopeKey'), false);
});

test('reader session caches reject clients opened on different publications', async () => {
  const cache = {};
  const first = createRitoCoreWasmInProcessReaderClient(
    fakeModule(() => undefined),
    cache,
  );
  await first.open(Uint8Array.of(1, 2, 3).buffer);
  first.dispose();

  const second = createRitoCoreWasmInProcessReaderClient(
    fakeModule(() => undefined),
    cache,
  );
  await assert.rejects(
    second.open(Uint8Array.of(1, 2, 4).buffer),
    /cannot be shared across different publications/,
  );
  second.dispose();
});

test('preview chapter text indices retain their inline public shape', async () => {
  const client = createRitoCoreWasmInProcessReaderClient(
    fakeModule(() =>
      viewPayload(
        { revisionId: 'preview-1', entries: CHAPTER_ENTRIES },
        { kind: 'preview', revisionId: 'preview-1' },
      ),
    ),
  );
  await client.open(new ArrayBuffer(0));

  const view = await client.createViewRevision({ ...VIEW_REQUEST, mode: 'preview' });
  client.dispose();

  assert.deepEqual(view.result.bundle.chapterTextIndices, {
    revisionId: 'preview-1',
    entries: CHAPTER_ENTRIES,
  });
});

test('reader accepts reordered follow-up defaults normalized by Rust serde', async () => {
  const request = {
    ...VIEW_REQUEST,
    mode: 'preview',
    layoutConfig: { ...VIEW_REQUEST.layoutConfig, textMeasurement: 'fixtureCompatible' },
  };
  const followUp = {
    delayMs: 1_000,
    request: {
      ...request,
      layoutConfig: { pageHeight: 480, pageWidth: 320 },
      lineBreaking: 'greedy',
      previousRevisionId: 'preview-policy',
      mode: 'full',
    },
  };
  const client = createRitoCoreWasmInProcessReaderClient(
    fakeModule(() =>
      viewPayload(
        { revisionId: 'preview-policy', entries: CHAPTER_ENTRIES },
        { kind: 'preview', revisionId: 'preview-policy', followUp },
      ),
    ),
  );
  await client.open(new ArrayBuffer(0));

  const view = await client.createViewRevision(request);
  client.dispose();

  assert.deepEqual(view.followUp, followUp);
});

for (const [name, requestOverrides, message] of [
  [
    'layout config',
    { layoutConfig: { pageWidth: 321, pageHeight: 480 } },
    /follow-up layoutConfig does not match/,
  ],
  ['line breaking', { lineBreaking: 'optimal' }, /follow-up lineBreaking does not match/],
]) {
  test(`reader rejects a follow-up with mismatched ${name} and releases its revision`, async () => {
    const requests = [];
    const request = { ...VIEW_REQUEST, mode: 'preview', lineBreaking: 'greedy' };
    const followUp = {
      delayMs: 1_000,
      request: {
        ...request,
        activeSpreadIndex: 2,
        previousRevisionId: 'preview-mismatch',
        mode: 'full',
        ...requestOverrides,
      },
    };
    const client = createRitoCoreWasmInProcessReaderClient(
      fakeModule((workerRequest) => {
        requests.push(workerRequest);
        if (workerRequest.kind === 'releaseRevision') return { kind: 'releaseRevision' };
        return viewPayload(
          { revisionId: 'preview-mismatch', entries: CHAPTER_ENTRIES },
          { kind: 'preview', revisionId: 'preview-mismatch', followUp },
        );
      }),
    );
    await client.open(new ArrayBuffer(0));

    await assert.rejects(client.createViewRevision(request), message);
    assert.deepEqual(requests.at(-1), {
      id: 0,
      kind: 'releaseRevision',
      revisionId: 'preview-mismatch',
    });
    client.dispose();
  });
}

test('full chapter text index references fail when their cache scope is unknown', async () => {
  const client = createRitoCoreWasmInProcessReaderClient(
    fakeModule(() => viewPayload({ revisionId: 'revision-1', scopeKey: FULL_SCOPE_KEY })),
  );
  await client.open(new ArrayBuffer(0));

  await assert.rejects(
    client.createViewRevision(VIEW_REQUEST),
    /chapter text indices reference unknown scope/,
  );
  client.dispose();
});

test('invalid chapter text transports release the created revision', async () => {
  const requests = [];
  const client = createRitoCoreWasmInProcessReaderClient(
    fakeModule((request) => {
      requests.push(request);
      if (request.kind === 'releaseRevision') return { kind: 'releaseRevision' };
      return viewPayload({
        revisionId: 'revision-1',
        scopeKey: FULL_SCOPE_KEY,
      });
    }),
  );
  await client.open(new ArrayBuffer(0));

  await assert.rejects(
    client.createViewRevision(VIEW_REQUEST),
    /chapter text indices reference unknown scope/,
  );
  assert.deepEqual(requests.at(-1), {
    id: 0,
    kind: 'releaseRevision',
    revisionId: 'revision-1',
  });
  client.dispose();
});

test('full chapter text cache hits reject unexpected inline entries', async () => {
  const cache = {};
  const first = createRitoCoreWasmInProcessReaderClient(
    fakeModule(() =>
      viewPayload({
        revisionId: 'revision-1',
        entries: CHAPTER_ENTRIES,
        scopeKey: FULL_SCOPE_KEY,
      }),
    ),
    cache,
  );
  await first.open(new ArrayBuffer(0));
  await first.createViewRevision(VIEW_REQUEST);
  first.dispose();

  const second = createRitoCoreWasmInProcessReaderClient(
    fakeModule(() =>
      viewPayload({
        revisionId: 'revision-2',
        entries: CHAPTER_ENTRIES,
        scopeKey: FULL_SCOPE_KEY,
      }),
    ),
    cache,
  );
  await second.open(new ArrayBuffer(0));
  await assert.rejects(
    second.createViewRevision(VIEW_REQUEST),
    /cache hit unexpectedly returned inline entries/,
  );
  second.dispose();
});

for (const [name, chapterTextIndices, revisionId, message] of [
  [
    'missing full scope',
    { revisionId: 'revision-1', entries: CHAPTER_ENTRIES },
    'revision-1',
    /missing their cache scope/,
  ],
  [
    'unknown full scope',
    { revisionId: 'revision-1', scopeKey: 'chapter-text-v2:full' },
    'revision-1',
    /use unknown scope/,
  ],
  [
    'mismatched revision',
    { revisionId: 'other-revision', entries: CHAPTER_ENTRIES, scopeKey: FULL_SCOPE_KEY },
    'revision-1',
    /revision does not match/,
  ],
]) {
  test(`reader rejects ${name} chapter text transport`, async () => {
    const client = createRitoCoreWasmInProcessReaderClient(
      fakeModule(() => viewPayload(chapterTextIndices, { revisionId })),
    );
    await client.open(new ArrayBuffer(0));
    await assert.rejects(client.createViewRevision(VIEW_REQUEST), message);
    client.dispose();
  });
}

function viewPayload(chapterTextIndices, options = {}) {
  const kind = options.kind ?? 'full';
  const revisionId = options.revisionId ?? chapterTextIndices.revisionId;
  return {
    kind: 'createViewRevision',
    result: {
      kind,
      display: 'revision',
      ...(options.followUp !== undefined ? { followUp: options.followUp } : {}),
      result: {
        bundle: {
          revision: { revisionId },
          chapterTextIndices,
        },
        preview: kind === 'preview',
      },
    },
  };
}

function fakeModule(handleRequest) {
  return {
    initRitoCoreWasmEngine: async () => ({
      openDocument: () => ({
        free() {},
        publication: () => ({ title: 'Fixture' }),
        readerWorkerPayload: handleRequest,
      }),
    }),
  };
}

function chapterEntries() {
  return JSON.parse(JSON.stringify(CHAPTER_ENTRIES));
}

class RespondingWorker {
  listeners = new Map();
  terminated = false;

  constructor(handleRequest) {
    this.handleRequest = handleRequest;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  postMessage(message) {
    if (message.kind === 'dispose') return;
    const payload =
      message.kind === 'open'
        ? { kind: 'open', result: { publication: { title: 'Fixture' } } }
        : this.handleRequest(message);
    queueMicrotask(() => this.emit('message', { data: { id: message.id, ok: true, payload } }));
  }

  terminate() {
    this.terminated = true;
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
