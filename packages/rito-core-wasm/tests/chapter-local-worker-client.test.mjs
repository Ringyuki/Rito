import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmWorkerReaderClient } from '../src/reader-worker-client-runtime.js';
import { readerOpenResult } from './reader-worker-test-fixture.mjs';

test('chapter-local create and continue each use one Worker request and canonicalize fragments', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const beforeCreate = worker.messages.length;
  const creating = client.createBoundedChapterLocalRevision(
    createRequest({ href: 'chapter.xhtml#%E7%AB%A0' }),
  );
  const createMessage = worker.messages.at(-1);
  assert.equal(worker.messages.length, beforeCreate + 1);
  assert.equal(createMessage.kind, 'createBoundedChapterLocalRevision');
  assert.deepEqual(createMessage.request.targetLocator, {
    href: 'chapter.xhtml',
    anchorId: '章',
  });
  const createdAdvance = pendingAdvance(owner(0), {
    href: 'chapter.xhtml',
    anchorId: '章',
  });
  worker.respond(createMessage.id, {
    kind: createMessage.kind,
    result: { advance: createdAdvance },
  });
  const created = await creating;

  const beforeContinue = worker.messages.length;
  const continuing = client.continueChapterLocalRevision({
    continuation: created.advance.continuation,
    budget: budget(),
  });
  const continueMessage = worker.messages.at(-1);
  assert.equal(worker.messages.length, beforeContinue + 1);
  assert.equal(continueMessage.kind, 'continueChapterLocalRevision');
  const continuedAdvance = completedAdvance(owner(1), createdAdvance.continuation.targetLocator, {
    releasedPreviousOwner: owner(0),
    releasedPreviousOwnerTransferCount: 2,
  });
  worker.respond(continueMessage.id, {
    kind: continueMessage.kind,
    result: { advance: continuedAdvance, frame: resolvedFrame(owner(1), 0) },
  });
  const continued = await continuing;

  assert.deepEqual(continued.advance.releasedPreviousOwner, owner(0));
  assert.equal(continued.advance.releasedPreviousOwnerTransferCount, 2);
  client.dispose();
});

test('chapter-local create rejects explicit and encoded fragment mismatches before dispatch', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const before = worker.messages.length;

  assert.throws(() =>
    client.createBoundedChapterLocalRevision(
      createRequest({ href: 'chapter.xhtml#%E7%AB%A0', anchorId: 'other' }),
    ),
  );
  assert.equal(worker.messages.length, before);

  const creating = client.createBoundedChapterLocalRevision(
    createRequest({ href: 'chapter.xhtml#%E7' }),
  );
  const message = worker.messages.at(-1);
  assert.deepEqual(message.request.targetLocator, { href: 'chapter.xhtml', anchorId: '%E7' });
  const advance = completedAdvance(owner(0), { href: 'chapter.xhtml', anchorId: '%E7' });
  worker.respond(message.id, {
    kind: message.kind,
    result: { advance, frame: resolvedFrame(owner(0), 0) },
  });
  assert.equal((await creating).advance.target.locator.anchorId, '%E7');
  client.dispose();
});

test('malformed committed create with a bound owner rolls back that exact local owner', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const creating = client.createBoundedChapterLocalRevision(
    createRequest({ href: 'chapter.xhtml' }),
  );
  const messageCount = worker.messages.length;
  const advance = pendingAdvance(owner(0), { href: 'chapter.xhtml' });
  worker.respondLast({
    kind: 'createBoundedChapterLocalRevision',
    result: {
      advance: {
        ...advance,
        releasedPreviousOwner: owner(99),
        releasedPreviousOwnerTransferCount: 0,
      },
    },
  });

  await waitForMessageCount(worker, messageCount + 1);
  const rollback = worker.messages.at(-1);
  assert.equal(rollback.kind, 'releaseChapterLocalRevision');
  assert.deepEqual(rollback.owner, owner(0));
  worker.respond(rollback.id, releasePayload(owner(0), true));
  await assert.rejects(creating, /forged predecessor-release proof/);
  assert.equal(worker.terminateCount, 0);
  client.dispose();
});

test('unbound malformed create disposes the Worker session without guessing an owner', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const creating = client.createBoundedChapterLocalRevision(
    createRequest({ href: 'chapter.xhtml' }),
  );
  worker.respondLast({
    kind: 'unrelated',
    result: { advance: pendingAdvance(owner(0), { href: 'chapter.xhtml' }) },
  });

  await assert.rejects(creating);
  await client.whenDisposed();
  assert.equal(worker.terminateCount, 1);
  assert.equal(
    worker.messages.filter(({ kind }) => kind === 'releaseChapterLocalRevision').length,
    0,
  );
});

test('unconfirmed exact N+1 continuation rollback disposes the Worker session', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const continuation = pendingAdvance(owner(0), { href: 'chapter.xhtml' }).continuation;
  const continuing = client.continueChapterLocalRevision({ continuation, budget: budget() });
  const messageCount = worker.messages.length;
  const advance = completedAdvance(owner(1), continuation.targetLocator, {
    releasedPreviousOwner: owner(0),
    releasedPreviousOwnerTransferCount: 1,
  });
  worker.respondLast({ kind: 'continueChapterLocalRevision', result: { advance } });

  await waitForMessageCount(worker, messageCount + 1);
  const rollback = worker.messages.at(-1);
  assert.deepEqual(rollback.owner, owner(1));
  worker.respond(rollback.id, releasePayload(owner(1), false));
  await assert.rejects(continuing, /omitted its resolved packed frame/);
  await client.whenDisposed();
  assert.equal(worker.terminateCount, 1);
});

test('create transport rejection disposes the Worker when no exact owner can be recovered', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const creating = client.createBoundedChapterLocalRevision(
    createRequest({ href: 'chapter.xhtml' }),
  );

  worker.rejectLast('create transport failed');

  await assert.rejects(creating, /create transport failed/);
  await client.whenDisposed();
  assert.equal(worker.terminateCount, 1);
});

test('continue transport rejection rolls back the predicted exact N+1 owner', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const continuation = pendingAdvance(owner(0), { href: 'chapter.xhtml' }).continuation;
  const continuing = client.continueChapterLocalRevision({ continuation, budget: budget() });
  const messageCount = worker.messages.length;

  worker.rejectLast('continue transport failed');

  await waitForMessageCount(worker, messageCount + 1);
  const rollback = worker.messages.at(-1);
  assert.equal(rollback.kind, 'releaseChapterLocalRevision');
  assert.deepEqual(rollback.owner, owner(1));
  worker.respond(rollback.id, releasePayload(owner(1), true));
  await assert.rejects(continuing, /continue transport failed/);
  assert.equal(worker.terminateCount, 0);
  client.dispose();
});

test('release transport rejection disposes the Worker to contain unknown ownership', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const releasing = client.releaseChapterLocalRevision(owner(0));

  worker.rejectLast('release transport failed');

  await assert.rejects(releasing, /release transport failed/);
  await client.whenDisposed();
  assert.equal(worker.terminateCount, 1);
});

function createRequest(targetLocator) {
  return {
    layoutConfig: { spreadMode: 'single' },
    lineBreaking: 'greedy',
    targetChapterIndex: 3,
    targetLocator,
    localPageCap: 4,
    budget: budget(),
  };
}

function budget() {
  return { maxTopLevelNodes: 1 };
}

function owner(revisionVersion) {
  return {
    revisionId: 'local-1',
    revisionVersion,
    coordinate: { kind: 'chapterLocal', chapterIndex: 3, href: 'chapter.xhtml' },
  };
}

function pendingAdvance(exactOwner, locator) {
  return {
    revision: summary(exactOwner, 'ready'),
    previousKnownExtent: { localPageCount: 0, localSpreadCount: 0 },
    newlyKnownLocalPages: { startLocalPage: 0, endLocalPageExclusive: 1 },
    processedTopLevelNodes: 1,
    target: {
      status: 'pending',
      owner: exactOwner,
      locator,
      spineIdref: 'chapter',
      reason: 'notPaginated',
      matchedBy: locator.anchorId ? 'anchor' : 'href',
    },
    continuation: { owner: exactOwner, cursor: 'cursor-1', targetLocator: locator },
  };
}

function completedAdvance(exactOwner, locator, fields = {}) {
  return {
    revision: summary(exactOwner, 'complete'),
    previousKnownExtent: { localPageCount: 0, localSpreadCount: 0 },
    newlyKnownLocalPages: { startLocalPage: 0, endLocalPageExclusive: 1 },
    processedTopLevelNodes: 1,
    target: {
      status: 'resolved',
      owner: exactOwner,
      locator,
      spineIdref: 'chapter',
      localPageIndex: 0,
      localSpreadIndex: 0,
      matchedBy: locator.anchorId ? 'anchor' : 'href',
    },
    ...fields,
  };
}

function summary(exactOwner, status) {
  const knownExtent = { localPageCount: 1, localSpreadCount: 1 };
  return {
    ...exactOwner,
    layoutKey: 'layout',
    status,
    localPageCap: 4,
    knownExtent,
    ...(status === 'complete' ? { finalExtent: knownExtent } : {}),
    pageCapReached: false,
  };
}

function resolvedFrame(exactOwner, localSpreadIndex) {
  const bytes = packedFrameBytes();
  return {
    owner: exactOwner,
    localSpreadIndex,
    metadata: frameMetadata(exactOwner, localSpreadIndex, bytes.byteLength),
    bytes,
    resources: [],
    missingResources: [],
  };
}

function packedFrameBytes() {
  const bytes = new Uint8Array(16);
  bytes.set(new TextEncoder().encode('RITOFCB2'));
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 2, true);
  view.setUint32(12, 0, true);
  return bytes;
}

function frameMetadata(exactOwner, localSpreadIndex, byteLength) {
  return {
    owner: exactOwner,
    localSpreadIndex,
    width: 320,
    height: 480,
    protocolVersion: 2,
    commandCount: 0,
    commandCounts: {},
    recordStats: {
      geometryRecords: 0,
      paintRecords: 0,
      payloadRecords: 0,
      primaryStringRecords: 0,
      secondaryStringRecords: 0,
    },
    byteLength,
    commandHash: 'empty-frame',
    resourceRefCount: 0,
    resourceTable: [],
    fontFamilies: [],
    imageDominated: false,
    stringTable: [],
    payloadTable: [],
  };
}

function releasePayload(exactOwner, releasedRevision) {
  return {
    kind: 'releaseChapterLocalRevision',
    result: { owner: exactOwner, releasedRevision, releasedTransferCount: 0 },
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

async function waitForMessageCount(worker, count) {
  for (let attempt = 0; attempt < 10 && worker.messages.length < count; attempt += 1) {
    await Promise.resolve();
  }
  assert.ok(worker.messages.length >= count, 'worker did not request exact local rollback');
}

class ManualWorker {
  listeners = new Map();
  messages = [];
  terminateCount = 0;

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      listeners.filter((candidate) => candidate !== listener),
    );
  }

  postMessage(message, transfer = []) {
    this.messages.push({ ...message, __transfer: [...transfer] });
  }

  terminate() {
    this.terminateCount += 1;
  }

  respondLast(payload) {
    this.respond(this.messages.at(-1).id, payload);
  }

  respond(id, payload) {
    this.emit('message', { data: { id, ok: true, payload } });
  }

  rejectLast(message) {
    this.reject(this.messages.at(-1).id, message);
  }

  reject(id, message) {
    this.emit('message', {
      data: {
        id,
        ok: false,
        error: { name: 'RitoCoreWasmError', message, code: 'internal-error' },
      },
    });
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
