import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createRitoCoreWasmInProcessReaderClient,
  createRitoCoreWasmReaderWorkerHandler,
  createRitoCoreWasmWorkerReaderClient,
} from '../dist/reader-worker-client-runtime.js';

test('reader clients expose stable unique session identities', () => {
  const module = { initRitoCoreWasmEngine: async () => ({ openDocument: () => undefined }) };
  const first = createRitoCoreWasmInProcessReaderClient(module);
  const second = createRitoCoreWasmInProcessReaderClient(module);
  const workerClient = createRitoCoreWasmWorkerReaderClient(new FakeWorker());
  const firstSessionId = first.sessionId;

  assert.equal(first.sessionId, firstSessionId);
  assert.notEqual(first.sessionId, second.sessionId);
  assert.notEqual(first.sessionId, workerClient.sessionId);
  assert.notEqual(second.sessionId, workerClient.sessionId);
  assert.match(first.sessionId, /^rito-reader-session-\d+$/);
  first.dispose();
  second.dispose();
  workerClient.dispose();
});

test('in-process reader allows only one document open', async () => {
  const ready = deferred();
  const entry = fakeDocument('first');
  let openCalls = 0;
  const client = createRitoCoreWasmInProcessReaderClient({
    initRitoCoreWasmEngine: () => ready.promise,
  });

  const firstOpen = client.open(new ArrayBuffer(1));
  await assert.rejects(client.open(new ArrayBuffer(1)), /cannot open while opening/);
  ready.resolve({
    openDocument: () => {
      openCalls += 1;
      return entry.document;
    },
  });

  assert.deepEqual(await firstOpen, { publication: { title: 'first' } });
  await assert.rejects(client.open(new ArrayBuffer(1)), /cannot open while open/);
  assert.equal(openCalls, 1);
  client.dispose();
  assert.equal(entry.state.freeCalls, 1);
});

test('in-process dispose prevents a pending open from reviving the session', async () => {
  const ready = deferred();
  let openCalls = 0;
  const client = createRitoCoreWasmInProcessReaderClient({
    initRitoCoreWasmEngine: () => ready.promise,
  });

  const opening = client.open(new ArrayBuffer(1));
  const rejected = assert.rejects(opening, /disposed while opening/);
  client.dispose();
  ready.resolve({
    openDocument: () => {
      openCalls += 1;
      return fakeDocument('late').document;
    },
  });

  await rejected;
  assert.equal(openCalls, 0);
});

test('failed publication rolls back the candidate and permits one retry', async () => {
  const bad = fakeDocument('bad', new Error('publication failed'));
  const good = fakeDocument('good');
  const documents = [bad.document, good.document];
  const client = createRitoCoreWasmInProcessReaderClient(
    {
      initRitoCoreWasmEngine: async () => ({ openDocument: () => documents.shift() }),
    },
    {},
  );

  await assert.rejects(client.open(Uint8Array.of(1).buffer), /publication failed/);
  assert.equal(bad.state.freeCalls, 1);

  assert.deepEqual(await client.open(Uint8Array.of(2).buffer), {
    publication: { title: 'good' },
  });
  assert.deepEqual(await client.search('rev-1', { query: 'text' }), {
    document: 'good',
  });
  client.dispose();
  assert.equal(good.state.freeCalls, 1);
});

test('worker endpoint rejects concurrent document opens without leaking', async () => {
  const ready = deferred();
  const entry = fakeDocument('worker');
  let openCalls = 0;
  const scope = workerHandlerScope(async () => ready.promise);

  const firstOpen = scope.send({ id: 1, kind: 'open', data: new ArrayBuffer(1) });
  const secondOpen = await scope.send({ id: 2, kind: 'open', data: new ArrayBuffer(1) });
  assert.equal(secondOpen.ok, false);
  assert.match(secondOpen.error.message, /cannot open while opening/);

  ready.resolve({
    openDocument: () => {
      openCalls += 1;
      return entry.document;
    },
  });
  assert.equal((await firstOpen).ok, true);
  assert.equal(openCalls, 1);
  assert.equal((await scope.send({ id: 3, kind: 'dispose' })).ok, true);
  assert.equal(entry.state.freeCalls, 1);
});

test('worker endpoint dispose invalidates an open waiting for initialization', async () => {
  const ready = deferred();
  let openCalls = 0;
  const scope = workerHandlerScope(async () => ready.promise);

  const opening = scope.send({ id: 1, kind: 'open', data: new ArrayBuffer(1) });
  assert.equal((await scope.send({ id: 2, kind: 'dispose' })).ok, true);
  ready.resolve({
    openDocument: () => {
      openCalls += 1;
      return fakeDocument('late-worker').document;
    },
  });

  const response = await opening;
  assert.equal(response.ok, false);
  assert.match(response.error.message, /disposed while opening/);
  assert.equal(openCalls, 0);
});

test('worker client terminates after disposal and fatal worker errors', async () => {
  const disposalWorker = new FakeWorker();
  disposalWorker.throwOnDispose = true;
  const disposalClient = createRitoCoreWasmWorkerReaderClient(disposalWorker);

  assert.doesNotThrow(() => disposalClient.dispose());
  assert.equal(disposalWorker.terminateCalls, 1);
  await assert.rejects(disposalClient.open(new ArrayBuffer(1)), /cannot open while disposed/);

  const failedWorker = new FakeWorker();
  const failedClient = createRitoCoreWasmWorkerReaderClient(failedWorker);
  const opening = failedClient.open(new ArrayBuffer(1));
  const rejected = assert.rejects(opening, /worker crashed/);
  failedWorker.emit('error', { message: 'worker crashed' });

  await rejected;
  assert.equal(failedWorker.terminateCalls, 1);
  await assert.rejects(failedClient.open(new ArrayBuffer(1)), /worker crashed/);
  failedClient.dispose();
  assert.equal(failedWorker.terminateCalls, 1);
});

function fakeDocument(name, publicationError) {
  const state = { freeCalls: 0 };
  return {
    state,
    document: {
      free: () => {
        state.freeCalls += 1;
      },
      publication: () => {
        if (publicationError) throw publicationError;
        return { title: name };
      },
      readerWorkerPayload: (request) => ({
        kind: request.kind,
        result: { document: name },
      }),
    },
  };
}

function workerHandlerScope(initialize) {
  const scope = new HandlerScope();
  createRitoCoreWasmReaderWorkerHandler(scope, {
    initRitoCoreWasmEngine: initialize,
    normalizeRitoCoreWasmError: normalizeError,
  });
  return scope;
}

function normalizeError(error) {
  return error instanceof Error ? error : new Error(String(error));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

class HandlerScope {
  listener;
  pending = new Map();

  addEventListener(type, listener) {
    assert.equal(type, 'message');
    this.listener = listener;
  }

  postMessage(message) {
    const resolve = this.pending.get(message.id);
    assert.ok(resolve, `unexpected worker response ${String(message.id)}`);
    this.pending.delete(message.id);
    resolve(message);
  }

  send(message) {
    assert.ok(this.listener, 'worker message listener is not installed');
    return new Promise((resolve) => {
      this.pending.set(message.id, resolve);
      this.listener({ data: message });
    });
  }
}

class FakeWorker {
  listeners = new Map();
  messages = [];
  terminateCalls = 0;
  throwOnDispose = false;

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  postMessage(message) {
    if (this.throwOnDispose && message.kind === 'dispose') {
      throw new Error('dispose post failed');
    }
    this.messages.push(message);
  }

  terminate() {
    this.terminateCalls += 1;
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
