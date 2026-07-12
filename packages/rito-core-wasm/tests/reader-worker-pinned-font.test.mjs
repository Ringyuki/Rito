import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createRitoCoreWasmInProcessReaderClient,
  createRitoCoreWasmWorkerReaderClient,
} from '../dist/reader-worker-client-runtime.js';

const HASH_A = 'ab'.repeat(32);
const HASH_B = 'cd'.repeat(32);
const POLICY_A = '12'.repeat(32);

test('worker open transfers publication and font buffers exactly once', async () => {
  const publication = Uint8Array.of(80, 75, 3, 4).buffer;
  const font = Uint8Array.of(1, 2, 3, 4).buffer;
  const worker = new TransferringWorker(() => openPayload(policySummary(POLICY_A, HASH_A, 4)));
  const client = createRitoCoreWasmWorkerReaderClient(worker);

  const result = await client.open(publication, options(font, HASH_A));

  assert.equal(publication.byteLength, 0);
  assert.equal(font.byteLength, 0);
  assert.equal(worker.transfers[0].length, 2);
  assert.equal(new Set(worker.transfers[0]).size, 2);
  const request = worker.messages[0];
  assert.equal(request.data.byteLength, 4);
  assert.equal(request.pinnedFontFaceBuffers[0].byteLength, 4);
  assert.deepEqual(request.pinnedFontPolicyMetadata, {
    schemaVersion: 1,
    faces: [{ expectedSha256: HASH_A, genericRole: 'serif', language: 'JA' }],
  });
  assert.equal(JSON.stringify(request.pinnedFontPolicyMetadata).includes('bytes'), false);
  assert.deepEqual(result, openPayload(policySummary(POLICY_A, HASH_A, 4)).result);
  assert.equal(JSON.stringify(result).includes('bytes'), false);
  client.dispose();
});

test('worker open binds canonical Rust face order independently of request order', async () => {
  const publication = Uint8Array.of(80, 75).buffer;
  const serif = Uint8Array.of(1, 2).buffer;
  const sans = Uint8Array.of(3, 4, 5).buffer;
  const summary = {
    schemaVersion: 1,
    policyId: POLICY_A,
    faces: [policyFace(HASH_A, 2, 'serif', 'ja'), policyFace(HASH_B, 3, 'sansSerif', 'zh')],
  };
  const worker = new TransferringWorker(() => openPayload(summary));
  const client = createRitoCoreWasmWorkerReaderClient(worker);

  const result = await client.open(publication, {
    pinnedFontPolicy: {
      schemaVersion: 1,
      faces: [
        { ...face(sans, HASH_B, 'sansSerif'), language: 'zh' },
        { ...face(serif, HASH_A, 'serif'), language: 'ja' },
      ],
    },
  });

  assert.deepEqual(result.pinnedFontPolicy.faces, summary.faces);
  assert.equal(worker.transfers[0].length, 3);
  client.dispose();
});

test('bad worker inputs reject before detaching any buffer', async () => {
  const worker = new SilentWorker();
  const client = createRitoCoreWasmWorkerReaderClient(worker);
  const publication = Uint8Array.of(1, 2, 3).buffer;
  const font = Uint8Array.of(4, 5, 6).buffer;

  await assert.rejects(
    client.open(publication, options(new Uint8Array(font), HASH_A)),
    hasBadRequest,
  );
  assert.equal(publication.byteLength, 3);
  assert.equal(font.byteLength, 3);

  await assert.rejects(client.open(publication, options(publication, HASH_A)), /exclusive/);
  assert.equal(publication.byteLength, 3);

  const duplicate = Uint8Array.of(7, 8).buffer;
  await assert.rejects(
    client.open(publication, {
      pinnedFontPolicy: {
        schemaVersion: 1,
        faces: [face(duplicate, HASH_A, 'serif'), face(duplicate, HASH_B, 'sansSerif')],
      },
    }),
    /exclusive/,
  );
  assert.equal(publication.byteLength, 3);
  assert.equal(duplicate.byteLength, 2);

  const invalid = Uint8Array.of(9).buffer;
  await assert.rejects(
    client.open(publication, {
      pinnedFontPolicy: {
        schemaVersion: 1,
        faces: [
          face(font, HASH_A, 'serif'),
          { ...face(invalid, HASH_B, 'sansSerif'), language: 'x--y' },
        ],
      },
    }),
    hasBadRequest,
  );
  assert.equal(font.byteLength, 3);
  assert.equal(invalid.byteLength, 1);
  assert.equal(worker.messages.length, 0);
  client.dispose();
});

test('in-process open creates zero-copy Uint8Array views and returns the same summary', async () => {
  const publication = Uint8Array.of(80, 75).buffer;
  const font = Uint8Array.of(1, 2, 3).buffer;
  const expected = policySummary(POLICY_A, HASH_A, 3);
  let received;
  const client = createRitoCoreWasmInProcessReaderClient({
    initRitoCoreWasmEngine: async () => ({
      openDocument: (bytes, directOptions) => {
        received = { bytes, directOptions };
        return fakeDocument(expected);
      },
    }),
  });

  const result = await client.open(publication, options(font, HASH_A));

  assert.equal(publication.byteLength, 2);
  assert.equal(font.byteLength, 3);
  assert.equal(received.bytes.buffer, publication);
  assert.equal(received.directOptions.pinnedFontPolicy.faces[0].bytes.buffer, font);
  assert.deepEqual(result.pinnedFontPolicy, expected);
  client.dispose();
});

test('summary failure frees the candidate and permits an in-process retry', async () => {
  const publication = Uint8Array.of(1).buffer;
  const font = Uint8Array.of(2, 3).buffer;
  const bad = fakeDocument(policySummary(POLICY_A, HASH_A, 3));
  const good = fakeDocument(policySummary(POLICY_A, HASH_A, 2));
  const candidates = [bad, good];
  const client = createRitoCoreWasmInProcessReaderClient({
    initRitoCoreWasmEngine: async () => ({ openDocument: () => candidates.shift() }),
  });

  await assert.rejects(client.open(publication, options(font, HASH_A)), /does not match/);
  assert.equal(bad.state.freeCalls, 1);
  assert.deepEqual(
    (await client.open(publication, options(font, HASH_A))).pinnedFontPolicy,
    good.pinnedFontPolicy(),
  );
  client.dispose();
  assert.equal(good.state.freeCalls, 1);
});

test('worker client rejects a forged pinned-font summary and terminates its session', async () => {
  const publication = Uint8Array.of(1).buffer;
  const font = Uint8Array.of(2, 3).buffer;
  const worker = new TransferringWorker(() =>
    openPayload(policySummary(POLICY_A, HASH_B, 2, 'sansSerif')),
  );
  const client = createRitoCoreWasmWorkerReaderClient(worker);

  await assert.rejects(client.open(publication, options(font, HASH_A)), /does not match/);
  assert.equal(worker.terminateCalls, 1);
  await assert.rejects(client.open(new ArrayBuffer(1)), /disposed/);
});

function options(bytes, expectedSha256) {
  return {
    pinnedFontPolicy: {
      schemaVersion: 1,
      faces: [{ ...face(bytes, expectedSha256, 'serif'), language: 'JA' }],
    },
  };
}

function face(bytes, expectedSha256, genericRole) {
  return { bytes, expectedSha256, genericRole };
}

function policySummary(policyId, sha256, byteLength, genericRole = 'serif') {
  return {
    schemaVersion: 1,
    policyId,
    faces: [policyFace(sha256, byteLength, genericRole, 'ja')],
  };
}

function policyFace(sha256, byteLength, genericRole, language) {
  return {
    sha256,
    shapeFingerprint: sha256.slice(0, 16),
    familyAlias: `__RitoPinned_${sha256}`,
    byteLength,
    genericRole,
    language,
    style: 'normal',
    weight: 400,
  };
}

function openPayload(pinnedFontPolicy) {
  return { kind: 'open', result: { publication: { title: 'Fixture' }, pinnedFontPolicy } };
}

function fakeDocument(summary) {
  const state = { freeCalls: 0 };
  return {
    state,
    publication: () => ({ title: 'Fixture' }),
    pinnedFontPolicy: () => summary,
    free: () => {
      state.freeCalls += 1;
    },
  };
}

function hasBadRequest(error) {
  return error?.code === 'bad-request';
}

class SilentWorker {
  listeners = new Map();
  messages = [];

  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  postMessage(message) {
    this.messages.push(message);
  }

  terminate() {}
}

class TransferringWorker extends SilentWorker {
  transfers = [];
  terminateCalls = 0;

  constructor(openResponse) {
    super();
    this.openResponse = openResponse;
  }

  postMessage(message, transfer = []) {
    if (message.kind === 'dispose') return;
    this.transfers.push([...transfer]);
    const received = structuredClone(message, { transfer: [...transfer] });
    this.messages.push(received);
    queueMicrotask(() => {
      const response = { id: received.id, ok: true, payload: this.openResponse(received) };
      for (const listener of this.listeners.get('message') ?? []) listener({ data: response });
    });
  }

  terminate() {
    this.terminateCalls += 1;
  }
}
