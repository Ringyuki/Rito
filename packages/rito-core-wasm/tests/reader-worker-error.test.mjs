import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RitoCoreWasmError } from '../dist/core-wasm-error-runtime.js';
import { createRitoCoreWasmWorkerReaderClient } from '../dist/reader-worker-client-runtime.js';

test('worker errors preserve only validated failed revision recovery state', async () => {
  const worker = new ErrorWorker();
  const client = createRitoCoreWasmWorkerReaderClient(worker);
  const failedRevision = {
    revisionId: 'rev-1',
    revisionVersion: 2,
    layoutKey: 'layout',
    status: 'failed',
    knownExtent: { pageCount: 1, spreadCount: 1 },
    pageCount: 1,
    spreadCount: 1,
  };
  const valid = client.getRevisionSummaryAtRevision(handle());
  worker.fail({
    name: 'RitoCoreWasmError',
    code: 'engine-error',
    message: 'failed',
    revision: failedRevision,
  });
  await assert.rejects(valid, (error) => {
    assert.ok(error instanceof RitoCoreWasmError);
    assert.equal(error.code, 'engine-error');
    assert.deepEqual(error.revision, failedRevision);
    return true;
  });

  const malformed = client.getRevisionSummaryAtRevision(handle());
  worker.fail({
    name: 'RitoCoreWasmError',
    code: 'stale-revision-version',
    message: 'stale',
    revision: { ...failedRevision, revisionVersion: -1 },
  });
  await assert.rejects(malformed, (error) => {
    assert.equal(error.code, 'stale-revision-version');
    assert.equal(error.message, 'stale');
    assert.equal(error.revision, undefined);
    return true;
  });

  for (const payload of [
    { code: 'stale-revision-version', revision: failedRevision },
    { code: 'engine-error', revision: { ...failedRevision, status: 'ready' } },
  ]) {
    const forged = client.getRevisionSummaryAtRevision(handle());
    worker.fail({ name: 'RitoCoreWasmError', message: 'forged', ...payload });
    await assert.rejects(forged, (error) => {
      assert.equal(error.code, payload.code);
      assert.equal(error.revision, undefined);
      return true;
    });
  }

  const unreadable = client.getRevisionSummaryAtRevision(handle());
  worker.fail(null);
  await assert.rejects(unreadable, (error) => {
    assert.equal(error.code, 'internal-error');
    assert.equal(error.message, 'Rito reader worker failed');
    assert.equal(error.name, 'RitoCoreWasmError');
    return true;
  });
  client.dispose();
});

function handle() {
  return { revisionId: 'rev-1', revisionVersion: 1 };
}

class ErrorWorker {
  messages = [];
  listeners = new Map();

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  postMessage(message) {
    this.messages.push(message);
  }

  terminate() {}

  fail(error) {
    this.listeners.get('message')({
      data: { id: this.messages.at(-1).id, ok: false, error },
    });
  }
}
