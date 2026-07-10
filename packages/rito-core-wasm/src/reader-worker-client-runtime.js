import {
  createReaderSessionState,
  disposeReaderSession,
  openReaderSessionDocument,
} from './reader-worker-session-runtime.js';
import {
  commitReaderSessionCache,
  createCachedReaderViewRevision,
  normalizeReaderSessionCache,
  prepareReaderSessionCache,
} from './reader-worker-cache-runtime.js';

export function createRitoCoreWasmWorkerReaderClient(worker, cache) {
  const sessionCache = normalizeReaderSessionCache(cache);
  const pending = new Map();
  let nextId = 1;
  let disposed = false;
  let terminalError;
  let terminated = false;
  const rejectAll = (error) => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };
  const terminate = () => {
    if (terminated) return;
    terminated = true;
    worker.terminate();
  };
  const fail = (error) => {
    terminalError ??= error;
    rejectAll(terminalError);
    terminate();
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
    fail(new Error(event.message || 'Rito reader worker failed'));
  });
  worker.addEventListener('messageerror', () => {
    fail(new Error('Rito reader worker sent an unreadable message'));
  });
  return createRitoCoreWasmReaderClient(
    async (input, transfer = []) => {
      if (disposed) throw new Error('Rito reader worker client is disposed');
      if (terminalError) throw terminalError;
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
      try {
        if (!terminated) worker.postMessage({ id: nextId, kind: 'dispose' });
      } catch {
        // Disposal is best effort; termination still owns the final cleanup.
      } finally {
        terminate();
      }
    },
    sessionCache,
  );
}

export function createRitoCoreWasmInProcessReaderClient(module, cache) {
  const state = createReaderSessionState();
  const sessionCache = normalizeReaderSessionCache(cache);
  return createRitoCoreWasmReaderClient(
    async (input) => {
      if (input.kind === 'open') {
        return openReaderSessionDocument(
          state,
          () =>
            module.initRitoCoreWasmEngine?.() ??
            Promise.reject(new Error('Rito in-process reader requires the full core module')),
          input.data,
          'Rito in-process reader',
        );
      }
      if (input.kind === 'dispose') {
        disposeReaderSession(state);
        return { kind: 'dispose' };
      }
      if (state.phase === 'disposed') {
        throw new Error('Rito reader in-process client is disposed');
      }
      if (!state.document) throw new Error('Rito in-process reader document is not open');
      return state.document.readerWorkerPayload({ ...input, id: 0 });
    },
    () => disposeReaderSession(state),
    sessionCache,
  );
}

export function createRitoCoreWasmReaderWorkerHandler(scope, deps) {
  const state = createReaderSessionState();
  scope.addEventListener('message', (event) => {
    void handleWorkerMessage(scope, deps, state, event.data);
  });
}

function createRitoCoreWasmReaderClient(request, dispose, cache) {
  let phase = 'idle';
  const open = async (data) => {
    if (phase !== 'idle') throw new Error(`Rito reader client cannot open while ${phase}`);
    phase = 'opening';
    try {
      const cacheIdentity = await prepareReaderSessionCache(cache, data);
      if (phase !== 'opening') throw new Error('Rito reader client was disposed while opening');
      const openResult = await result(request, { kind: 'open', data }, 'open', [data]);
      if (phase !== 'opening') throw new Error('Rito reader client was disposed while opening');
      commitReaderSessionCache(cache, cacheIdentity, () => {
        phase = 'disposed';
        dispose();
      });
      phase = 'open';
      return openResult;
    } catch (error) {
      if (phase === 'opening') phase = 'idle';
      throw error;
    }
  };
  const disposeClient = () => {
    if (phase === 'disposed') return;
    phase = 'disposed';
    dispose();
  };
  return {
    open,
    createViewRevision: (viewRequest) =>
      createCachedReaderViewRevision(cache, viewRequest, readerRuntimeWire(), request),
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
    dispose: disposeClient,
  };
}

function readerRuntimeWire() {
  return globalThis.__RITO_CORE_WASM_READER_WIRE__ === 'ritorb1' ? 'ritorb1' : 'json';
}

async function handleWorkerMessage(scope, deps, state, message) {
  const workerStartedAt = wireMetricsRequest(message) ? monotonicNow() : undefined;
  if (!isRequest(message)) return;
  try {
    const internalPayload = await handleWorkerRequest(deps, state, message);
    const prepared = prepareWorkerPayload(internalPayload);
    const transfer = responseTransfer(prepared.payload);
    const response = { id: message.id, ok: true, payload: prepared.payload };
    if (workerStartedAt !== undefined) {
      response.__ritoWireMetrics = completeWorkerWireMetrics(prepared.metrics, workerStartedAt);
    }
    scope.postMessage(response, transfer);
  } catch (error) {
    scope.postMessage({ id: message.id, ok: false, error: toWorkerError(deps, error) });
  }
}

function wireMetricsRequest(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return value.kind === 'createViewRevision' && value.__ritoCollectWireMetrics === true;
}

function prepareWorkerPayload(payload) {
  if (!Object.hasOwn(payload, '__ritoWireMetrics')) {
    return { payload, metrics: undefined };
  }
  const { __ritoWireMetrics: metrics, ...publicPayload } = payload;
  return { payload: publicPayload, metrics };
}

function completeWorkerWireMetrics(metrics, workerStartedAt) {
  if (metrics === null || typeof metrics !== 'object' || Array.isArray(metrics)) {
    throw new Error('Rito reader worker did not receive view-revision wire metrics');
  }
  return {
    ...metrics,
    workerProcessingMs: elapsedMilliseconds(workerStartedAt),
  };
}

function monotonicNow() {
  return globalThis.performance.now();
}

function elapsedMilliseconds(startedAt) {
  const elapsed = monotonicNow() - startedAt;
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0;
}

async function handleWorkerRequest(deps, state, request) {
  if (request.kind === 'open') {
    return openReaderSessionDocument(
      state,
      deps.initRitoCoreWasmEngine,
      request.data,
      'Rito reader worker',
    );
  }
  if (request.kind === 'dispose') {
    disposeReaderSession(state);
    return { kind: 'dispose' };
  }
  if (state.phase === 'disposed') throw new Error('Rito reader worker is disposed');
  if (!state.document) throw new Error('Rito reader worker document is not open');
  return state.document.readerWorkerPayload(request);
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
