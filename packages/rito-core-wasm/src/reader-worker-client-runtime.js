export function createRitoCoreWasmWorkerReaderClient(worker) {
  const pending = new Map();
  let nextId = 1;
  let disposed = false;
  const rejectAll = (error) => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };
  worker.addEventListener('message', (event) => {
    if (!isResponse(event.data)) return;
    const entry = pending.get(event.data.id);
    if (!entry) return;
    pending.delete(event.data.id);
    if (event.data.ok) entry.resolve(event.data.payload);
    else entry.reject(workerError(event.data.error));
  });
  worker.addEventListener('error', (event) => {
    rejectAll(new Error(event.message || 'Rito reader worker failed'));
  });
  worker.addEventListener('messageerror', () => {
    rejectAll(new Error('Rito reader worker sent an unreadable message'));
  });
  return createRitoCoreWasmReaderClient(
    async (input, transfer = []) => {
      if (disposed) throw new Error('Rito reader worker client is disposed');
      const id = nextId;
      nextId += 1;
      const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      try {
        worker.postMessage({ ...input, id }, [...transfer]);
      } catch (error) {
        pending.delete(id);
        throw error instanceof Error ? error : new Error(String(error));
      }
      return promise;
    },
    () => {
      if (disposed) return;
      disposed = true;
      rejectAll(new Error('Rito reader worker client disposed'));
      worker.postMessage({ id: nextId, kind: 'dispose' });
      worker.terminate();
    },
  );
}

export function createRitoCoreWasmInProcessReaderClient(module) {
  let corePromise;
  let document;
  let disposed = false;
  return createRitoCoreWasmReaderClient(
    async (input) => {
      if (disposed) throw new Error('Rito reader in-process client is disposed');
      if (input.kind === 'open') {
        document?.free();
        corePromise ??=
          module.initRitoCoreWasmEngine?.() ??
          Promise.reject(new Error('Rito in-process reader requires the full core module'));
        const core = await corePromise;
        document = core.openDocument(new Uint8Array(input.data));
        return { kind: 'open', result: { publication: document.publication() } };
      }
      if (input.kind === 'dispose') {
        document?.free();
        document = undefined;
        return { kind: 'dispose' };
      }
      if (!document) throw new Error('Rito in-process reader document is not open');
      return document.readerWorkerPayload({ ...input, id: 0 });
    },
    () => {
      if (disposed) return;
      disposed = true;
      document?.free();
      document = undefined;
    },
  );
}

export function createRitoCoreWasmReaderWorkerHandler(scope, deps) {
  const state = { corePromise: undefined, document: undefined };
  scope.addEventListener('message', (event) => {
    void handleWorkerMessage(scope, deps, state, event.data);
  });
}

function createRitoCoreWasmReaderClient(request, dispose) {
  return {
    open: (data) => result(request, { kind: 'open', data }, 'open', [data]),
    createViewRevision: (viewRequest) =>
      result(
        request,
        { kind: 'createViewRevision', request: viewRequest, wire: readerRuntimeWire() },
        'createViewRevision',
      ),
    readResource: (revisionId, resourceKind, href) =>
      result(request, { kind: 'readResource', revisionId, resourceKind, href }, 'readResource'),
    warmFrameWindow: (revisionId, spreadIndex) =>
      result(request, { kind: 'warmFrameWindow', revisionId, spreadIndex }, 'warmFrameWindow'),
    resolveLocator: (revisionId, locator) =>
      result(request, { kind: 'resolveLocator', revisionId, locator }, 'resolveLocator'),
    search: (revisionId, searchRequest) =>
      result(request, { kind: 'search', revisionId, request: searchRequest }, 'search'),
    releaseRevisionTransfers: async (revisionId) => {
      const payload = await request({ kind: 'releaseRevisionTransfers', revisionId });
      if (payload.kind !== 'releaseRevisionTransfers') {
        throw new Error(`Rito reader worker returned ${payload.kind} for releaseRevisionTransfers`);
      }
    },
    releaseRevision: async (revisionId) => {
      const payload = await request({ kind: 'releaseRevision', revisionId });
      if (payload.kind !== 'releaseRevision') {
        throw new Error(`Rito reader worker returned ${payload.kind} for releaseRevision`);
      }
    },
    dispose,
  };
}

function readerRuntimeWire() {
  return globalThis.__RITO_CORE_WASM_READER_WIRE__ === 'ritorb1' ? 'ritorb1' : 'json';
}

async function handleWorkerMessage(scope, deps, state, message) {
  if (!isRequest(message)) return;
  try {
    const payload = await handleWorkerRequest(deps, state, message);
    scope.postMessage({ id: message.id, ok: true, payload }, responseTransfer(payload));
  } catch (error) {
    scope.postMessage({ id: message.id, ok: false, error: toWorkerError(deps, error) });
  }
}

async function handleWorkerRequest(deps, state, request) {
  if (request.kind === 'open') return openWorkerDocument(deps, state, request.data);
  if (request.kind === 'dispose') {
    disposeWorkerDocument(state);
    return { kind: 'dispose' };
  }
  if (!state.document) throw new Error('Rito reader worker document is not open');
  return state.document.readerWorkerPayload(request);
}

async function openWorkerDocument(deps, state, data) {
  disposeWorkerDocument(state);
  state.corePromise ??= deps.initRitoCoreWasmEngine();
  const core = await state.corePromise;
  state.document = core.openDocument(new Uint8Array(data));
  return { kind: 'open', result: { publication: state.document.publication() } };
}

function disposeWorkerDocument(state) {
  state.document?.free();
  state.document = undefined;
}

async function result(request, input, kind, transfer) {
  const payload = await request(input, transfer);
  if (payload.kind !== kind)
    throw new Error(`Rito reader worker returned ${payload.kind} for ${kind}`);
  return payload.result;
}

function toWorkerError(deps, error) {
  const normalized = deps.normalizeRitoCoreWasmError(error, 'rito reader worker');
  return {
    name: normalized.name,
    message: normalized.message,
    code: normalized.code,
  };
}

function workerError(error) {
  const out = new Error(error.message);
  out.name = error.name || 'Error';
  if (error.code !== undefined) out.code = error.code;
  return out;
}

function isRequest(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return typeof value.id === 'number' && typeof value.kind === 'string';
}

function isResponse(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return typeof value.id === 'number' && typeof value.ok === 'boolean';
}

function responseTransfer(payload) {
  switch (payload.kind) {
    case 'createViewRevision':
      return payload.result.result.frameWindow
        ? frameWindowTransfers(payload.result.result.frameWindow)
        : [];
    case 'warmFrameWindow':
      return frameWindowTransfers(payload.result);
    case 'readResource':
      return [payload.result.bytes.buffer];
    default:
      return [];
  }
}

function frameWindowTransfers(result) {
  return Array.from(
    new Set([
      ...result.frames.map((frame) => frame.bytes.buffer),
      ...result.spreads.flatMap((spread) =>
        spread.resources.map((resource) => resource.bytes.buffer),
      ),
    ]),
  );
}
