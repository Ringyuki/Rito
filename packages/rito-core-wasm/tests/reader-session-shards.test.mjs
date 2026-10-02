import assert from 'node:assert/strict';
import test from 'node:test';

import { createRitoCoreWasmReaderSessionWorkerClient } from '../src/reader-session-worker-client-runtime.js';
import { createRitoCoreWasmReaderSessionWorkerHandler } from '../src/reader-session-worker-runtime.js';
import { ReaderWireReader } from '../src/reader-session-wire-base-runtime.js';
import { artifactWire, request } from './helpers/reader-session-fixtures.mjs';

const POLICY = { metadataJson: '{}', faces: [Uint8Array.of(1)] };

function pending(...shardIds) {
  return Object.assign(new Error('waits on shards'), {
    code: 'resource-pending',
    pendingShards: shardIds,
  });
}

function requestIds(bytes) {
  const reader = new ReaderWireReader(bytes);
  reader.u64('magic');
  reader.u32('version');
  reader.u64('length');
  return { sessionId: reader.externalId('session'), requestId: reader.externalId('request') };
}

/** A raw session whose chapter needs shards 2 and 5 before it lays out. */
function shardedRawSession(log) {
  return class RawSession {
    static openShardsWithPinnedFontPolicy(skeleton, key, sessionId) {
      log.push(['open', [...skeleton], key, sessionId]);
      return new RawSession();
    }

    supplied = new Set();

    supplyShard(bytes, key) {
      const shardId = bytes[0];
      log.push(['supply', shardId, key]);
      this.supplied.add(shardId);
      return shardId;
    }

    requestArtifact(bytes) {
      const ids = requestIds(bytes);
      log.push(['request', ids.requestId]);
      const missing = [2, 5].filter((id) => !this.supplied.has(id));
      if (missing.length > 0) throw pending(...missing);
      return artifactWire(ids.sessionId, ids.requestId, 9n, 'Text/one.xhtml');
    }

    readFootnote() {
      if (!this.supplied.has(7)) throw pending(7);
      throw Object.assign(new Error('done'), { code: 'target-not-published' });
    }

    dispose() {
      return true;
    }
  };
}

test('a sharded session opens, supplies what the chapter needs and asks again', async () => {
  const log = [];
  const loads = [];
  const client = createRitoCoreWasmReaderSessionWorkerClient(
    connectedWorker(shardedRawSession(log)),
  );
  const key = new Uint8Array(32).fill(3);
  const artifact = await client.open(
    {
      skeleton: Uint8Array.of(8, 8).buffer,
      key,
      loadShards: async (ids) => {
        loads.push([...ids]);
        return ids.map((id) => ({ id, bytes: Uint8Array.of(id), key }));
      },
    },
    request('Text/one.xhtml'),
    POLICY,
  );
  assert.equal(artifact.artifactId, 9n);
  assert.deepEqual(log[0].slice(0, 2), ['open', [8, 8]]);
  assert.deepEqual(log[0][2], key);
  const requests = log.filter((entry) => entry[0] === 'request').map((entry) => entry[1]);
  assert.equal(requests.length, 2);
  assert.ok(requests[1] > requests[0], 'the retry carries a fresh request identity');
  assert.deepEqual(
    log.filter((entry) => entry[0] === 'supply').map((entry) => entry[1]),
    [2, 5],
  );
  assert.deepEqual(loads.sort(), [[2], [5]]);

  await assert.rejects(client.readFootnote(9n, 'Text/two.xhtml#n1'), {
    code: 'target-not-published',
  });
  assert.deepEqual(loads.at(-1), [7], 'a query supplies its shard and retries');
  await client.dispose();
});

test('a rejected load fails the open without leaving a session behind', async () => {
  const log = [];
  const client = createRitoCoreWasmReaderSessionWorkerClient(
    connectedWorker(shardedRawSession(log)),
  );
  await assert.rejects(
    client.open(
      {
        skeleton: Uint8Array.of(1).buffer,
        loadShards: async () => {
          throw new Error('not entitled');
        },
      },
      request('Text/one.xhtml'),
      POLICY,
    ),
    /not entitled/,
  );
  await assert.rejects(client.readPublication(), { code: 'session-disposed' });
});

/** A client transport wired straight into a real worker handler. */
function connectedWorker(RitoReaderSession) {
  const listeners = new Map();
  const scope = {
    addEventListener(type, listener) {
      if (type === 'message') scope.listener = listener;
    },
    postMessage(message) {
      queueMicrotask(() => listeners.get('message')?.({ data: message }));
    },
  };
  createRitoCoreWasmReaderSessionWorkerHandler(scope, {
    initRitoCoreWasm: async () => undefined,
    RitoReaderSession,
  });
  return {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    postMessage(message) {
      queueMicrotask(() => scope.listener({ data: message }));
    },
    terminate() {},
  };
}
