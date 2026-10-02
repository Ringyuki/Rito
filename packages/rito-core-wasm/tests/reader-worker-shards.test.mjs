import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RitoCoreWasmError } from '../dist/core-wasm-error-runtime.js';
import { createRitoCoreWasmWorkerReaderClient } from '../dist/reader-worker-client-runtime.js';

const KEY = new Uint8Array(32).fill(7);
const FACE_HASH = '03'.repeat(32);
const POLICY = {
  pinnedFontPolicy: {
    schemaVersion: 1,
    faces: [
      {
        bytes: Uint8Array.of(1, 2, 3).buffer,
        expectedSha256: FACE_HASH,
        genericRole: 'serif',
        language: 'ja',
      },
    ],
  },
};

test('a sharded open sends the skeleton and keeps the caller copy', async () => {
  const worker = new ScriptedWorker();
  const client = createRitoCoreWasmWorkerReaderClient(worker);
  const skeleton = Uint8Array.of(9, 9).buffer;
  const opening = client.open({ skeleton, key: KEY, loadShards: async () => [] }, POLICY);
  await settle();
  const open = worker.take('open');
  assert.deepEqual(new Uint8Array(open.message.skeleton), Uint8Array.of(9, 9));
  assert.deepEqual(open.message.skeletonKey, KEY);
  assert.equal(Object.hasOwn(open.message, 'data'), false);
  assert.equal(skeleton.byteLength, 2, 'the caller keeps its skeleton to reopen elsewhere');
  worker.succeed(open, { kind: 'open', result: readerOpenResult() });
  await opening;
  client.dispose();
});

test('a pending call loads, supplies and retries the identical call', async () => {
  const worker = new ScriptedWorker();
  const loads = [];
  const client = createRitoCoreWasmWorkerReaderClient(worker);
  const opening = client.open(
    {
      skeleton: Uint8Array.of(1).buffer,
      loadShards: async (ids) => {
        loads.push(ids);
        return ids.map((id) => ({ id, bytes: Uint8Array.of(id, id), key: KEY }));
      },
    },
    POLICY,
  );
  await settle();
  worker.succeed(worker.take('open'), { kind: 'open', result: readerOpenResult() });
  await opening;

  const reading = client.readResource('rev-1', 'image', 'a.png');
  await settle();
  const first = worker.take('readResource');
  worker.fail(first, { code: 'resource-pending', message: 'waits', pendingShards: [4, 2] });
  await settle();
  const supplied = [worker.take('supplyShard'), worker.take('supplyShard')];
  assert.deepEqual(supplied.map((entry) => [...new Uint8Array(entry.message.shard)]).sort(), [
    [2, 2],
    [4, 4],
  ]);
  assert.deepEqual(supplied[0].message.key, KEY);
  assert.deepEqual(loads.map((ids) => [...ids]).sort(), [[2], [4]]);
  for (const entry of supplied) {
    worker.succeed(entry, { kind: 'supplyShard', result: new Uint8Array(entry.message.shard)[0] });
  }
  await settle();
  const retry = worker.take('readResource');
  assert.deepEqual(
    { ...retry.message, id: 0 },
    { ...first.message, id: 0 },
    'the retry is the identical call',
  );
  const bytes = Uint8Array.of(5);
  worker.succeed(retry, { kind: 'readResource', result: { payload: {}, bytes } });
  assert.equal((await reading).bytes, bytes);
  client.dispose();
});

test('a loader that fails or returns another shard fails only that call', async () => {
  const worker = new ScriptedWorker();
  let mode = 'reject';
  const client = createRitoCoreWasmWorkerReaderClient(worker);
  const opening = client.open(
    {
      skeleton: Uint8Array.of(1).buffer,
      loadShards: async (ids) => {
        if (mode === 'reject') throw new Error('not entitled');
        return ids.map((id) => ({ id, bytes: Uint8Array.of(9) }));
      },
    },
    POLICY,
  );
  await settle();
  worker.succeed(worker.take('open'), { kind: 'open', result: readerOpenResult() });
  await opening;

  const denied = client.readResource('rev-1', 'image', 'a.png');
  await settle();
  worker.fail(worker.take('readResource'), {
    code: 'resource-pending',
    message: 'waits',
    pendingShards: [3],
  });
  await assert.rejects(denied, /not entitled/);

  mode = 'wrong';
  const mismatched = client.readResource('rev-1', 'image', 'a.png');
  await settle();
  worker.fail(worker.take('readResource'), {
    code: 'resource-pending',
    message: 'waits',
    pendingShards: [3],
  });
  await settle();
  worker.succeed(worker.take('supplyShard'), { kind: 'supplyShard', result: 9 });
  await assert.rejects(mismatched, (error) => {
    assert.ok(error instanceof RitoCoreWasmError);
    assert.match(error.message, /another shard/);
    return true;
  });
  client.dispose();
});

test('a shard handed over as a view of a larger buffer is copied by its own window', async () => {
  const worker = new ScriptedWorker();
  const client = createRitoCoreWasmWorkerReaderClient(worker);
  const opening = client.open(
    {
      skeleton: Uint8Array.of(1).buffer,
      // Node's Buffer.slice shares its pool instead of copying.
      loadShards: async (ids) => ids.map((id) => ({ id, bytes: Buffer.from([id, 7, 7]) })),
    },
    POLICY,
  );
  await settle();
  worker.succeed(worker.take('open'), { kind: 'open', result: readerOpenResult() });
  await opening;
  const reading = client.readResource('rev-1', 'image', 'a.png');
  await settle();
  worker.fail(worker.take('readResource'), {
    code: 'resource-pending',
    message: 'waits',
    pendingShards: [3],
  });
  await settle();
  const supplied = worker.take('supplyShard');
  assert.deepEqual([...new Uint8Array(supplied.message.shard)], [3, 7, 7]);
  worker.succeed(supplied, { kind: 'supplyShard', result: 3 });
  await settle();
  worker.succeed(worker.take('readResource'), {
    kind: 'readResource',
    result: { payload: {}, bytes: Uint8Array.of(1) },
  });
  await reading;
  client.dispose();
});

test('a pending error without shards is not trusted', async () => {
  const worker = new ScriptedWorker();
  const client = createRitoCoreWasmWorkerReaderClient(worker);
  const reading = client.getRevisionSummaryAtRevision({ revisionId: 'rev-1', revisionVersion: 1 });
  await settle();
  worker.fail(worker.messages.at(-1), { code: 'resource-pending', message: 'waits' });
  await assert.rejects(reading, (error) => {
    assert.equal(error.code, 'internal-error');
    return true;
  });
  client.dispose();
});

function readerOpenResult() {
  return {
    publication: { title: 'Fixture' },
    pinnedFontPolicy: {
      schemaVersion: 1,
      policyId: '01'.repeat(32),
      faces: [
        {
          sha256: FACE_HASH,
          shapeFingerprint: FACE_HASH.slice(0, 16),
          familyAlias: `__RitoPinned_${FACE_HASH}`,
          byteLength: 3,
          genericRole: 'serif',
          language: 'ja',
          style: 'normal',
          weight: 400,
        },
      ],
    },
  };
}

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

class ScriptedWorker {
  messages = [];
  listeners = new Map();

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener() {}

  postMessage(message) {
    this.messages.push({ id: message.id, message });
  }

  terminate() {}

  take(kind) {
    const index = this.messages.findIndex((entry) => entry.message.kind === kind);
    assert.notEqual(index, -1, `expected a ${kind} message`);
    return this.messages.splice(index, 1)[0];
  }

  succeed(entry, payload) {
    this.listeners.get('message')({ data: { id: entry.id, ok: true, payload } });
  }

  fail(entry, error) {
    this.listeners.get('message')({
      data: { id: entry.id, ok: false, error: { name: 'RitoCoreWasmError', ...error } },
    });
  }
}
