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

  assert.deepEqual(await firstOpen, {
    publication: { title: 'first' },
    pinnedFontPolicy: emptyPolicySummary(),
  });
  await assert.rejects(client.open(new ArrayBuffer(1)), /cannot open while open/);
  assert.equal(openCalls, 1);
  const disposed = client.whenDisposed();
  client.dispose();
  assert.equal(entry.state.freeCalls, 1);
  await disposed;
});

test('in-process dispose prevents a pending open from reviving the session', async () => {
  const ready = deferred();
  let openCalls = 0;
  const client = createRitoCoreWasmInProcessReaderClient({
    initRitoCoreWasmEngine: () => ready.promise,
  });

  const opening = client.open(new ArrayBuffer(1));
  const rejected = assert.rejects(opening, /disposed while opening/);
  const disposed = client.whenDisposed();
  client.dispose();
  await disposed;
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
    pinnedFontPolicy: emptyPolicySummary(),
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
  assert.deepEqual(await scope.send({ id: 3, kind: 'dispose' }), {
    id: 3,
    ok: true,
    payload: { kind: 'dispose', releasedDocument: true },
  });
  assert.equal(entry.state.freeCalls, 1);
});

test('worker endpoint dispose invalidates an open waiting for initialization', async () => {
  const ready = deferred();
  let openCalls = 0;
  const scope = workerHandlerScope(async () => ready.promise);

  const opening = scope.send({ id: 1, kind: 'open', data: new ArrayBuffer(1) });
  assert.deepEqual(await scope.send({ id: 2, kind: 'dispose' }), {
    id: 2,
    ok: true,
    payload: { kind: 'dispose', releasedDocument: false },
  });
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

test('worker endpoint reuses its initialized engine after releasing a document', async () => {
  const first = fakeDocument('first-worker-document');
  const second = fakeDocument('second-worker-document');
  const documents = [first.document, second.document];
  let initializeCalls = 0;
  const scope = workerHandlerScope(async () => {
    initializeCalls += 1;
    return { openDocument: () => documents.shift() };
  });

  assert.equal((await scope.send({ id: 1, kind: 'open', data: new ArrayBuffer(1) })).ok, true);
  assert.equal((await scope.send({ id: 2, kind: 'dispose' })).payload.releasedDocument, true);
  assert.equal((await scope.send({ id: 3, kind: 'open', data: new ArrayBuffer(1) })).ok, true);
  assert.equal((await scope.send({ id: 4, kind: 'dispose' })).payload.releasedDocument, true);

  assert.equal(initializeCalls, 1);
  assert.equal(first.state.freeCalls, 1);
  assert.equal(second.state.freeCalls, 1);
});

test('worker client terminates after disposal and fatal worker errors', async () => {
  const disposalWorker = new FakeWorker();
  disposalWorker.throwOnDispose = true;
  const disposalClient = createRitoCoreWasmWorkerReaderClient(disposalWorker);

  assert.doesNotThrow(() => disposalClient.dispose());
  assert.equal(disposalWorker.terminateCalls, 1);
  await disposalClient.whenDisposed();
  await assert.rejects(disposalClient.open(new ArrayBuffer(1)), /cannot open while disposed/);

  const failedWorker = new FakeWorker();
  const failedClient = createRitoCoreWasmWorkerReaderClient(failedWorker);
  const opening = failedClient.open(new ArrayBuffer(1));
  const rejected = assert.rejects(opening, /worker crashed/);
  failedWorker.emit('error', { message: 'worker crashed' });

  await rejected;
  assert.equal(failedWorker.terminateCalls, 1);
  await failedClient.whenDisposed();
  await assert.rejects(failedClient.open(new ArrayBuffer(1)), /worker crashed/);
  failedClient.dispose();
  assert.equal(failedWorker.terminateCalls, 1);
});

test('worker client rolls back partial listener installation', () => {
  for (const failureIndex of [1, 2, 3]) {
    const worker = new FakeWorker();
    const sentinel = new Error(`listener ${String(failureIndex)} failed`);
    let addCalls = 0;
    const addEventListener = worker.addEventListener.bind(worker);
    worker.addEventListener = (type, listener) => {
      addCalls += 1;
      if (addCalls === failureIndex) throw sentinel;
      addEventListener(type, listener);
    };

    assert.throws(() => createRitoCoreWasmWorkerReaderClient(worker), sentinel);
    assert.equal(worker.listenerCount(), 0);
    assert.equal(worker.terminateCalls, 1);
  }
});

test('worker client waits for the document-release acknowledgement before termination', async () => {
  const worker = new FakeWorker();
  const client = createRitoCoreWasmWorkerReaderClient(worker);
  const disposed = client.whenDisposed();

  client.dispose();

  assert.equal(worker.terminateCalls, 0);
  assert.equal(client.whenDisposed(), disposed);
  const request = worker.messages.at(-1);
  assert.equal(request.kind, 'dispose');
  worker.emit('message', {
    data: {
      id: request.id,
      ok: true,
      payload: { kind: 'dispose', releasedDocument: false },
    },
  });
  await disposed;
  assert.equal(worker.terminateCalls, 1);
});

test('worker client rejects a malformed disposal acknowledgement', async () => {
  const worker = new FakeWorker();
  let recycleCalls = 0;
  const client = createRitoCoreWasmWorkerReaderClient(worker, undefined, {
    recycleWorker: () => {
      recycleCalls += 1;
      return true;
    },
  });

  client.dispose();
  const request = worker.messages.at(-1);
  worker.emit('message', {
    data: { id: request.id, ok: true, payload: { kind: 'dispose' } },
  });

  await client.whenDisposed();
  assert.equal(worker.terminateCalls, 1);
  assert.equal(recycleCalls, 0);
});

test('worker client rejects disposal completion when termination fails', async () => {
  const worker = new FakeWorker();
  worker.terminateError = new Error('worker termination failed');
  const client = createRitoCoreWasmWorkerReaderClient(worker);

  client.dispose();
  const request = worker.messages.at(-1);
  worker.emit('message', {
    data: {
      id: request.id,
      ok: true,
      payload: { kind: 'dispose', releasedDocument: false },
    },
  });

  await assert.rejects(client.whenDisposed(), /worker termination failed/);
  assert.equal(worker.terminateCalls, 1);
  assert.equal(worker.listenerCount(), 0);
});

test('worker client rejects releasedDocument false after a successful open', async () => {
  const worker = new FakeWorker();
  let recycleCalls = 0;
  const client = createRitoCoreWasmWorkerReaderClient(worker, undefined, {
    recycleWorker: () => {
      recycleCalls += 1;
      return true;
    },
  });
  const opening = client.open(new ArrayBuffer(1));
  await Promise.resolve();
  const openRequest = worker.messages.at(-1);
  worker.emit('message', {
    data: {
      id: openRequest.id,
      ok: true,
      payload: {
        kind: 'open',
        result: { publication: { title: 'opened' }, pinnedFontPolicy: emptyPolicySummary() },
      },
    },
  });
  await opening;

  client.dispose();
  const disposeRequest = worker.messages.at(-1);
  worker.emit('message', {
    data: {
      id: disposeRequest.id,
      ok: true,
      payload: { kind: 'dispose', releasedDocument: false },
    },
  });

  await client.whenDisposed();
  assert.equal(worker.terminateCalls, 1);
  assert.equal(recycleCalls, 0);
});

test('worker client recycles only after a confirmed document release and detaches listeners', async () => {
  const worker = new FakeWorker();
  const recycled = [];
  const client = createRitoCoreWasmWorkerReaderClient(worker, undefined, {
    recycleWorker: (candidate) => {
      recycled.push(candidate);
      return true;
    },
  });
  const opening = client.open(new ArrayBuffer(1));
  await Promise.resolve();
  const openRequest = worker.messages.at(-1);
  worker.emit('message', {
    data: {
      id: openRequest.id,
      ok: true,
      payload: {
        kind: 'open',
        result: { publication: { title: 'opened' }, pinnedFontPolicy: emptyPolicySummary() },
      },
    },
  });
  await opening;

  client.dispose();
  const disposeRequest = worker.messages.at(-1);
  worker.emit('message', {
    data: {
      id: disposeRequest.id,
      ok: true,
      payload: { kind: 'dispose', releasedDocument: true },
    },
  });
  await client.whenDisposed();

  assert.deepEqual(recycled, [worker]);
  assert.equal(worker.terminateCalls, 0);
  assert.equal(worker.listenerCount(), 0);
});

test('worker client accepts either release result while an open is unconfirmed', async () => {
  for (const releasedDocument of [false, true]) {
    const worker = new FakeWorker();
    const client = createRitoCoreWasmWorkerReaderClient(worker);
    const opening = client.open(new ArrayBuffer(1));
    await Promise.resolve();
    const rejected = assert.rejects(opening, /disposed/);

    client.dispose();
    const disposeRequest = worker.messages.at(-1);
    worker.emit('message', {
      data: {
        id: disposeRequest.id,
        ok: true,
        payload: { kind: 'dispose', releasedDocument },
      },
    });

    await Promise.all([rejected, client.whenDisposed()]);
    assert.equal(worker.terminateCalls, 1);
  }
});

test('worker client force-terminates when disposal is not acknowledged', async () => {
  const worker = new FakeWorker();
  const client = createRitoCoreWasmWorkerReaderClient(worker);

  client.dispose();
  assert.equal(worker.terminateCalls, 0);

  await client.whenDisposed();

  assert.equal(worker.terminateCalls, 1);
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
      pinnedFontPolicy: emptyPolicySummary,
      readerWorkerPayload: (request) => ({
        kind: request.kind,
        result: { document: name },
      }),
    },
  };
}

function emptyPolicySummary() {
  return { schemaVersion: 1, policyId: '01'.repeat(32), faces: [] };
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
  terminateError = undefined;
  throwOnDispose = false;

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      listeners.filter((candidate) => candidate !== listener),
    );
  }

  postMessage(message) {
    if (this.throwOnDispose && message.kind === 'dispose') {
      throw new Error('dispose post failed');
    }
    this.messages.push(message);
  }

  terminate() {
    this.terminateCalls += 1;
    if (this.terminateError) throw this.terminateError;
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  listenerCount() {
    return [...this.listeners.values()].reduce((count, listeners) => count + listeners.length, 0);
  }
}
