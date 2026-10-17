import assert from 'node:assert/strict';
import test from 'node:test';

import { createRitoCoreWasmReaderSessionWorkerHandler } from '../src/reader-session-worker-runtime.js';
import { artifactWire, layout, settle, workerScope } from './helpers/reader-session-fixtures.mjs';

function openMessage() {
  return {
    protocol: 'rito-reader-session',
    id: 1,
    kind: 'open',
    publication: new ArrayBuffer(8),
    sessionId: 7n,
    request: {
      sessionId: 7n,
      requestId: 1n,
      layout,
      locator: { href: 'Text/Section001.xhtml' },
      textProfile: 'platform-string-runs',
    },
  };
}

/** A raw session that counts how often it is opened and freed. */
function countingSession() {
  const counts = { opened: 0, disposed: 0, freed: 0 };
  class RawSession {
    constructor() {
      counts.opened += 1;
    }

    requestArtifact() {
      return artifactWire(7n, 1n, 41n, 'Text/Section001.xhtml');
    }

    dispose() {
      counts.disposed += 1;
      return true;
    }

    free() {
      counts.freed += 1;
    }
  }
  return { counts, RawSession };
}

test('a scope that closes without a dispose frees its open session', async () => {
  const scope = workerScope();
  const { counts, RawSession } = countingSession();
  const handle = createRitoCoreWasmReaderSessionWorkerHandler(scope, {
    initRitoCoreWasm: async () => undefined,
    RitoReaderSession: RawSession,
  });
  scope.dispatch(openMessage());
  await settle();
  assert.equal(scope.responses[0]?.message.ok, true);
  assert.deepEqual(counts, { opened: 1, disposed: 0, freed: 0 });

  handle.close();
  assert.deepEqual(counts, { opened: 1, disposed: 1, freed: 1 });
  // Closing twice frees nothing twice.
  handle.close();
  assert.deepEqual(counts, { opened: 1, disposed: 1, freed: 1 });
});

test('a scope that closes while the engine loads opens no session', async () => {
  const scope = workerScope();
  const { counts, RawSession } = countingSession();
  let loaded;
  const handle = createRitoCoreWasmReaderSessionWorkerHandler(scope, {
    initRitoCoreWasm: () =>
      new Promise((resolve) => {
        loaded = resolve;
      }),
    RitoReaderSession: RawSession,
  });
  scope.dispatch(openMessage());
  await settle();
  handle.close();
  loaded();
  await settle();
  assert.equal(counts.opened, 0);
  assert.equal(scope.responses[0]?.message.ok, false);
  assert.equal(scope.responses[0]?.message.error.code, 'session-disposed');
});
