import assert from 'node:assert/strict';
import test from 'node:test';

import { createRitoCoreWasmReaderSessionWorkerClient } from '../src/reader-session-worker-client-runtime.js';
import { createRitoCoreWasmReaderSessionWorkerHandler } from '../src/reader-session-worker-runtime.js';
import { ReaderWireReader, ReaderWireWriter } from '../src/reader-session-wire-base-runtime.js';
import { artifactWire, request } from './helpers/reader-session-fixtures.mjs';

const POLICY = { metadataJson: '{}', faces: [Uint8Array.of(1)] };
const IMAGE = Uint8Array.of(137, 80, 78, 71);

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

function resourceWire(artifactId, href) {
  const writer = ReaderWireWriter.message('RITORES1');
  writer.externalId(artifactId, 'artifact');
  writer.u32(0, 'image kind');
  writer.string(href, 'href');
  writer.string('image/png', 'media type');
  writer.u64(BigInt(IMAGE.byteLength), 'resource bytes length');
  writer.raw(IMAGE);
  writer.option(undefined, () => {});
  writer.option(undefined, () => {});
  return writer.finish();
}

/** A raw session laid out from its skeleton whose image sits in shard 4. */
function shardedRawSession(log, shardOrder) {
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
      return artifactWire(ids.sessionId, ids.requestId, 9n, 'Text/one.xhtml');
    }

    contentShardsNear(href) {
      log.push(['order', href]);
      if (shardOrder === undefined) throw new Error('no shard order');
      return Uint32Array.from(shardOrder);
    }

    readResource(artifactId, kind, href) {
      log.push(['read', href]);
      if (!this.supplied.has(4)) throw pending(4);
      return resourceWire(artifactId, href);
    }

    dispose() {
      return true;
    }
  };
}

test('a sharded session opens from its skeleton without loading a shard', async () => {
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
  assert.deepEqual(loads, [], 'layout never waits on a shard');

  const resource = await client.readResource(9n, 'image', 'Images/one.png');
  assert.deepEqual(resource.bytes, IMAGE);
  assert.deepEqual(loads, [[4]]);
  assert.deepEqual(
    log.filter((entry) => entry[0] === 'read' || entry[0] === 'supply'),
    [
      ['read', 'Images/one.png'],
      ['supply', 4, key],
      ['read', 'Images/one.png'],
    ],
    'the identical read is sent again once the shard is in',
  );
  await client.dispose();
});

test('a rejected load fails only the read that needed it', async () => {
  const log = [];
  const client = createRitoCoreWasmReaderSessionWorkerClient(
    connectedWorker(shardedRawSession(log)),
  );
  let allowed = false;
  await client.open(
    {
      skeleton: Uint8Array.of(1).buffer,
      loadShards: async (ids) => {
        if (!allowed) throw new Error('not entitled');
        return ids.map((id) => ({ id, bytes: Uint8Array.of(id) }));
      },
    },
    request('Text/one.xhtml'),
    POLICY,
  );
  await assert.rejects(client.readResource(9n, 'image', 'Images/one.png'), /not entitled/);
  allowed = true;
  const resource = await client.readResource(9n, 'image', 'Images/one.png');
  assert.deepEqual(resource.bytes, IMAGE, 'the session stays usable');
  await client.dispose();
});

test('a sharded session supplies image shards ahead of need, nearest first', async () => {
  const log = [];
  const loads = [];
  const client = createRitoCoreWasmReaderSessionWorkerClient(
    connectedWorker(shardedRawSession(log, [4, 6, 5])),
  );
  await client.open(
    {
      skeleton: Uint8Array.of(1).buffer,
      loadShards: async (ids) => {
        loads.push([...ids]);
        return ids.map((id) => ({ id, bytes: Uint8Array.of(id) }));
      },
    },
    request('Text/one.xhtml'),
    POLICY,
  );
  for (let tick = 0; tick < 20 && loads.length < 3; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.deepEqual(loads, [[4], [6], [5]], 'one at a time, in the order the engine gave');
  assert.deepEqual(
    log.filter((entry) => entry[0] === 'order'),
    [['order', 'Text/one.xhtml']],
    'ordered from the opened page',
  );

  const resource = await client.readResource(9n, 'image', 'Images/one.png');
  assert.deepEqual(resource.bytes, IMAGE);
  assert.equal(loads.length, 3, 'the read found its shard already supplied');
  await client.dispose();
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
