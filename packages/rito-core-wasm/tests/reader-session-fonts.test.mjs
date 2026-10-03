import assert from 'node:assert/strict';
import test from 'node:test';

import { createRitoCoreWasmReaderSessionWorkerClient } from '../src/reader-session-worker-client-runtime.js';
import { createRitoCoreWasmReaderSessionWorkerHandler } from '../src/reader-session-worker-runtime.js';
import { ReaderWireReader } from '../src/reader-session-wire-base-runtime.js';
import { artifactWire, request } from './helpers/reader-session-fixtures.mjs';

const POLICY = { metadataJson: '{}', faces: [Uint8Array.of(1)] };
const SANS = 'b'.repeat(64);

// Byte-for-byte pins shared with the Rust encoder and the Dart decoder
// (crates/rito-core/src/runtime/reader_session/wire/fonts.rs).
const FONT_CATALOG_HEX =
  '5249544f464e5431010000006a00000000000000020000000500000054696e6f' +
  '7300000000010000000103000000756e64010000009001060000006e6f726d61' +
  '6c0102000000616204000000426f6f6b01000000000000000001000000bc0206' +
  '0000006974616c696300';
const FONT_NAMES_HEX =
  '5249544f464e4e31010000003300000000000000020000000c0000004e6f2053' +
  '75636820466163650700000047656f72676961';

function bytes(hex) {
  return Uint8Array.from(hex.match(/../g), (pair) => Number.parseInt(pair, 16));
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

    fontCatalog() {
      return answers.catalog ?? bytes(FONT_CATALOG_HEX);
    }

    unresolvedFontFamilies(list) {
      log.push(['unresolved', list]);
      return bytes(FONT_NAMES_HEX);
    }

    addHostFontFaces(metadataJson, faces) {
      log.push(['add', JSON.parse(metadataJson), faces.map((face) => [...face])]);
    }

    removeHostFontFaces(sha256s) {
      log.push(['remove', sha256s]);
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

test('a session answers its font catalog and the names a list would skip as core wires', async () => {
  const log = [];
  const client = await openClient(log, {});
  assert.deepEqual(await client.fontCatalog(), {
    families: [
      {
        name: 'Tinos',
        source: 'host',
        genericRole: 'serif',
        language: 'und',
        faces: [{ weight: 400, style: 'normal', sha256: 'ab' }],
      },
      {
        name: 'Book',
        source: 'publication',
        genericRole: null,
        language: null,
        faces: [{ weight: 700, style: 'italic', sha256: null }],
      },
    ],
  });
  assert.deepEqual(await client.unresolvedFontFamilies('No Such Face, Georgia'), [
    'No Such Face',
    'Georgia',
  ]);
  assert.deepEqual(log, [['unresolved', 'No Such Face, Georgia']]);
  await client.dispose();
});

test('a font catalog wire that does not end where its length says is refused', async () => {
  const truncated = bytes(FONT_CATALOG_HEX).slice(0, -1);
  const client = await openClient([], { catalog: truncated });
  await assert.rejects(client.fontCatalog());
  await client.dispose();
});

test('added faces cross with their bytes handed over', async () => {
  const log = [];
  const transfers = [];
  const client = await openClient(log, {}, transfers);
  const faceBytes = Uint8Array.of(1, 2, 3, 4).buffer;
  await client.addHostFontFaces([
    { bytes: faceBytes, expectedSha256: SANS, genericRole: 'sansSerif' },
  ]);
  const sent = transfers.find(([kind]) => kind === 'add-host-font-faces');
  assert.deepEqual(sent?.[1], [faceBytes], 'the face bytes are handed over, not copied');
  assert.deepEqual(log[0], [
    'add',
    { schemaVersion: 1, faces: [{ expectedSha256: SANS, genericRole: 'sansSerif' }] },
    [[1, 2, 3, 4]],
  ]);
  await client.dispose();
});

test('removed faces are named by digest', async () => {
  const log = [];
  const client = await openClient(log, {});
  await client.removeHostFontFaces([SANS]);
  assert.deepEqual(log, [['remove', [SANS]]]);
  await client.dispose();
});
