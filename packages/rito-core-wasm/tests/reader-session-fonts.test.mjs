import assert from 'node:assert/strict';
import test from 'node:test';

import { createRitoCoreWasmReaderSessionWorkerClient } from '../src/reader-session-worker-client-runtime.js';
import { createRitoCoreWasmReaderSessionWorkerHandler } from '../src/reader-session-worker-runtime.js';
import { ReaderWireReader } from '../src/reader-session-wire-base-runtime.js';
import { artifactWire, request } from './helpers/reader-session-fixtures.mjs';

const POLICY = { metadataJson: '{}', faces: [Uint8Array.of(1)] };
const SERIF = 'a'.repeat(64);
const SANS = 'b'.repeat(64);

function summaryFace(sha256, genericRole, familyName) {
  return {
    sha256,
    familyName,
    shapeFingerprint: sha256.slice(0, 16),
    familyAlias: `__RitoPinned_${sha256}`,
    byteLength: 4,
    genericRole,
    language: 'und',
    style: 'normal',
    weight: 400,
  };
}

function summary(...faces) {
  return JSON.stringify({ schemaVersion: 1, policyId: 'c'.repeat(64), faces });
}

/** A raw session whose fonts answer from what the test set. */
function fontRawSession(log, answers) {
  return class RawSession {
    static openWithPinnedFontPolicy() {
      return new RawSession();
    }

    requestArtifact(bytes) {
      const reader = new ReaderWireReader(bytes);
      reader.u64('magic');
      reader.u32('version');
      reader.u64('length');
      const sessionId = reader.externalId('session');
      return artifactWire(sessionId, reader.externalId('request'), 9n, 'Text/one.xhtml');
    }

    fontCatalogJson() {
      return JSON.stringify({ families: [{ name: 'Tinos', source: 'host' }] });
    }

    unresolvedFontFamiliesJson(list) {
      log.push(['unresolved', list]);
      return JSON.stringify(['Arimo']);
    }

    addHostFontFaces(metadataJson, faces) {
      log.push(['add', JSON.parse(metadataJson), faces.map((face) => [...face])]);
      return answers.added;
    }

    removeHostFontFacesJson(json) {
      log.push(['remove', JSON.parse(json)]);
      return summary(summaryFace(SERIF, 'serif', 'Tinos'));
    }

    releaseArtifact() {
      return true;
    }

    dispose() {
      return true;
    }
  };
}

function connectedWorker(RitoReaderSession, transfers = []) {
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
    postMessage(message, transfer = []) {
      transfers.push([message.kind, [...transfer]]);
      queueMicrotask(() => scope.listener({ data: message }));
    },
    terminate() {},
  };
}

async function openClient(log, answers, transfers) {
  const client = createRitoCoreWasmReaderSessionWorkerClient(
    connectedWorker(fontRawSession(log, answers), transfers),
  );
  await client.open(Uint8Array.of(8).buffer, request('Text/one.xhtml'), POLICY);
  return client;
}

test('a session answers its font catalog and the names a list would skip', async () => {
  const log = [];
  const client = await openClient(log, {});
  assert.deepEqual(await client.fontCatalog(), { families: [{ name: 'Tinos', source: 'host' }] });
  assert.deepEqual(await client.unresolvedFontFamilies('Arimo, serif'), ['Arimo']);
  assert.deepEqual(log, [['unresolved', 'Arimo, serif']]);
  await client.dispose();
});

test('added faces cross with their bytes and must come back at the summary end', async () => {
  const log = [];
  const answers = {
    added: summary(summaryFace(SERIF, 'serif', 'Tinos'), summaryFace(SANS, 'sansSerif', 'Arimo')),
  };
  const transfers = [];
  const client = await openClient(log, answers, transfers);
  const bytes = Uint8Array.of(1, 2, 3, 4).buffer;
  const extended = await client.addHostFontFaces([
    { bytes, expectedSha256: SANS, genericRole: 'sansSerif' },
  ]);
  assert.equal(extended.faces[1].familyName, 'Arimo');
  const sent = transfers.find(([kind]) => kind === 'add-host-font-faces');
  assert.deepEqual(sent?.[1], [bytes], 'the face bytes are handed over, not copied');
  assert.deepEqual(log[0], [
    'add',
    { schemaVersion: 1, faces: [{ expectedSha256: SANS, genericRole: 'sansSerif' }] },
    [[1, 2, 3, 4]],
  ]);

  // A summary that does not end with the face asked for is refused.
  answers.added = summary(summaryFace(SERIF, 'serif', 'Tinos'));
  await assert.rejects(
    client.addHostFontFaces([
      { bytes: Uint8Array.of(5, 6, 7, 8).buffer, expectedSha256: SANS, genericRole: 'sansSerif' },
    ]),
  );
  await client.dispose();
});

test('removed faces are named by digest and the remaining summary is validated', async () => {
  const log = [];
  const client = await openClient(log, {});
  const remaining = await client.removeHostFontFaces([SANS]);
  assert.deepEqual(
    remaining.faces.map((face) => face.familyName),
    ['Tinos'],
  );
  assert.deepEqual(log, [['remove', [SANS]]]);
  await client.dispose();
});
