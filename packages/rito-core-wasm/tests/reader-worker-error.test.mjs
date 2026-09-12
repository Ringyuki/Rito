import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RitoCoreWasmError } from '../dist/core-wasm-error-runtime.js';
import { createRitoCoreWasmWorkerReaderClient } from '../dist/reader-worker-client-runtime.js';

test('worker errors keep their wire code, message and name', async () => {
  const worker = new ErrorWorker();
  const client = createRitoCoreWasmWorkerReaderClient(worker);

  const failing = client.getRevisionSummaryAtRevision(handle());
  worker.fail({ name: 'RitoCoreWasmError', code: 'engine-error', message: 'failed' });
  await assert.rejects(failing, (error) => {
    assert.ok(error instanceof RitoCoreWasmError);
    assert.equal(error.code, 'engine-error');
    assert.equal(error.message, 'failed');
    return true;
  });

  const stale = client.getRevisionSummaryAtRevision(handle());
  worker.fail({ name: 'RitoCoreWasmError', code: 'stale-revision-version', message: 'stale' });
  await assert.rejects(stale, (error) => {
    assert.equal(error.code, 'stale-revision-version');
    assert.equal(error.message, 'stale');
    return true;
  });

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
