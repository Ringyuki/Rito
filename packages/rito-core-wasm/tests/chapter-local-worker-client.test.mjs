import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmWorkerReaderClient } from '../src/reader-worker-client-runtime.js';
import { readerOpenResult } from './reader-worker-test-fixture.mjs';

test('chapter-local create uses one Worker request and canonicalizes fragments', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const beforeCreate = worker.messages.length;
  const creating = client.createChapterLocalRevision(
    createRequest({ href: 'chapter.xhtml#%E7%AB%A0' }),
  );
  const createMessage = worker.messages.at(-1);
  assert.equal(worker.messages.length, beforeCreate + 1);
  assert.equal(createMessage.kind, 'createChapterLocalRevision');
  assert.deepEqual(createMessage.request.targetLocator, {
    href: 'chapter.xhtml',
    anchorId: '章',
  });
  const locator = { href: 'chapter.xhtml', anchorId: '章' };
  worker.respond(createMessage.id, {
    kind: createMessage.kind,
    result: { created: createdRevision(owner(0), locator), frame: resolvedFrame(owner(0), 0) },
  });
  const created = await creating;

  assert.deepEqual(created.created.target.locator, locator);
  assert.equal(created.frame.localSpreadIndex, 0);
  client.dispose();
});

test('chapter-local create rejects explicit and encoded fragment mismatches before dispatch', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const before = worker.messages.length;

  assert.throws(() =>
    client.createChapterLocalRevision(
      createRequest({ href: 'chapter.xhtml#%E7%AB%A0', anchorId: 'other' }),
    ),
  );
  assert.equal(worker.messages.length, before);

  const creating = client.createChapterLocalRevision(createRequest({ href: 'chapter.xhtml#%E7' }));
  const message = worker.messages.at(-1);
  assert.deepEqual(message.request.targetLocator, { href: 'chapter.xhtml', anchorId: '%E7' });
  const created = createdRevision(owner(0), { href: 'chapter.xhtml', anchorId: '%E7' });
  worker.respond(message.id, {
    kind: message.kind,
    result: { created, frame: resolvedFrame(owner(0), 0) },
  });
  assert.equal((await creating).created.target.locator.anchorId, '%E7');
  client.dispose();
});

test('malformed committed create with a bound owner rolls back that exact local owner', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const creating = client.createChapterLocalRevision(createRequest({ href: 'chapter.xhtml' }));
  const messageCount = worker.messages.length;
  const created = createdRevision(owner(0), { href: 'chapter.xhtml' });
  worker.respondLast({
    kind: 'createChapterLocalRevision',
    result: {
      created: {
        ...created,
        target: { ...created.target, localSpreadIndex: 2 },
      },
    },
  });

  await waitForMessageCount(worker, messageCount + 1);
  const rollback = worker.messages.at(-1);
  assert.equal(rollback.kind, 'releaseChapterLocalRevision');
  assert.deepEqual(rollback.owner, owner(0));
  worker.respond(rollback.id, releasePayload(owner(0), true));
  await assert.rejects(creating, /resolved target lies outside its local extent/);
  assert.equal(worker.terminateCount, 0);
  client.dispose();
});

test('unbound malformed create disposes the Worker session without guessing an owner', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const creating = client.createChapterLocalRevision(createRequest({ href: 'chapter.xhtml' }));
  worker.respondLast({
    kind: 'unrelated',
    result: { created: createdRevision(owner(0), { href: 'chapter.xhtml' }) },
  });

  await assert.rejects(creating);
  await client.whenDisposed();
  assert.equal(worker.terminateCount, 1);
  assert.equal(
    worker.messages.filter(({ kind }) => kind === 'releaseChapterLocalRevision').length,
    0,
  );
});

test('typed create failure propagates without disposing the shared Worker session', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const creating = client.createChapterLocalRevision(createRequest({ href: 'chapter.xhtml' }));
  const messageCount = worker.messages.length;

  worker.rejectLast('create failed in the worker');

  await assert.rejects(creating, /create failed in the worker/);
  assert.equal(worker.terminateCount, 0);
  assert.equal(worker.messages.length, messageCount);
  client.dispose();
});

test('channel-level create failure still disposes the Worker session', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  const creating = client.createChapterLocalRevision(createRequest({ href: 'chapter.xhtml' }));

  worker.emit('error', { message: 'reader worker crashed' });

  await assert.rejects(creating, /reader worker crashed/);
  await client.whenDisposed();
  assert.ok(worker.terminateCount >= 1);
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
    targetChapterIndex: 3,
    targetLocator,
  };
}

function owner(revisionVersion) {
  return {
    revisionId: 'local-1',
    revisionVersion,
    coordinate: { kind: 'chapterLocal', chapterIndex: 3, href: 'chapter.xhtml' },
  };
}

function createdRevision(exactOwner, locator) {
  return {
    revision: summary(exactOwner),
    target: {
      status: 'resolved',
      owner: exactOwner,
      locator,
      spineIdref: 'chapter',
      localPageIndex: 0,
      localSpreadIndex: 0,
      matchedBy: locator.anchorId ? 'anchor' : 'href',
    },
  };
}

function summary(exactOwner) {
  return {
    ...exactOwner,
    layoutKey: 'layout',
    localPageCount: 1,
    localSpreadCount: 1,
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
  // An empty RITODL1 format-2 list: magic, version 2, ratio 1, no primitives.
  const bytes = new Uint8Array(23);
  bytes.set(new TextEncoder().encode('RITODL1'));
  const view = new DataView(bytes.buffer);
  view.setUint32(7, 2, true);
  view.setFloat64(11, 1, true);
  view.setUint32(19, 0, true);
  return bytes;
}

function frameMetadata(exactOwner, localSpreadIndex, byteLength) {
  return {
    owner: exactOwner,
    localSpreadIndex,
    width: 320,
    height: 480,
    protocolVersion: 2,
    ratio: 1,
    commandCount: 0,
    commandCounts: {},
    primitiveCount: 0,
    byteLength,
    commandHash: 'empty-frame',
    resourceRefCount: 0,
    resourceTable: [],
    fontFamilies: [],
    imageDominated: false,
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
