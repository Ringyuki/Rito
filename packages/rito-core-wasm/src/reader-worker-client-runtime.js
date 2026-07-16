import {
  beginReaderSessionRelease,
  createReaderSessionState,
  disposeReaderSession,
  openReaderSessionDocument,
  releaseReaderSessionDocument,
} from './reader-worker-session-runtime.js';
import {
  commitReaderSessionCache,
  createCachedReaderViewRevision,
  normalizeReaderSessionCache,
  prepareReaderSessionCache,
} from './reader-worker-cache-runtime.js';
import { isRitoCoreWasmRevisionSummary, RitoCoreWasmError } from './core-wasm-error-runtime.js';
import { createVersionedReaderClientMethods } from './reader-worker-versioned-client-runtime.js';
import {
  decodeReaderWorkerOpenRequest,
  prepareReaderWorkerOpen,
  validateReaderWorkerOpenResult,
} from './reader-worker-pinned-font-runtime.js';

let nextReaderSessionId = 1;
const nextWorkerRequestIds = new WeakMap();
const WORKER_DISPOSE_ACK_TIMEOUT_MS = 1_000;

export function createRitoCoreWasmWorkerReaderClient(worker, cache, options) {
  const sessionId = createReaderSessionId();
  const sessionCache = normalizeReaderSessionCache(cache);
  const disposal = createDisposalCompletion();
  const pending = new Map();
  let disposed = false;
  let disposeRequestId;
  let disposeTimer;
  let terminalError;
  let finalized = false;
  let documentOpened = false;
  const rejectAll = (error) => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };
  const detachWorkerListeners = () => {
    try {
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
      worker.removeEventListener('messageerror', handleMessageError);
      return true;
    } catch {
      return false;
    }
  };
  const finalizeWorker = (allowRecycle) => {
    if (finalized) return;
    finalized = true;
    if (disposeTimer !== undefined) globalThis.clearTimeout(disposeTimer);
    disposeTimer = undefined;
    const detached = detachWorkerListeners();
    let recycled = false;
    if (allowRecycle && detached && options?.recycleWorker) {
      try {
        recycled = options.recycleWorker(worker) === true;
      } catch {
        // A failed recycle hook must not retain a Worker with unknown ownership.
      }
    }
    let terminationError;
    try {
      if (!recycled) worker.terminate();
    } catch (error) {
      terminationError = error instanceof Error ? error : new Error(String(error));
    }
    if (terminationError) {
      disposal.reject(terminationError);
    } else {
      disposal.resolve();
    }
  };
  const terminate = () => finalizeWorker(false);
  const fail = (error) => {
    terminalError ??= error;
    rejectAll(terminalError);
    terminate();
  };
  const forceDispose = () => {
    if (!disposed) {
      disposed = true;
      rejectAll(new Error('Rito reader worker client disposed'));
    }
    terminate();
  };
  const handleMessage = (event) => {
    const response = event.data;
    if (disposeRequestId !== undefined && responseId(response) === disposeRequestId) {
      const acknowledged =
        isResponse(response) && isDisposeAcknowledgement(response, documentOpened);
      finalizeWorker(acknowledged && response.payload.releasedDocument === true);
      return;
    }
    if (!isResponse(response)) return;
    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    if (response.ok && response.payload?.kind === 'open') documentOpened = true;
    if (response.ok) entry.resolve(response.payload);
    else entry.reject(workerError(response.error));
  };
  const handleError = (event) => {
    fail(new Error(event.message || 'Rito reader worker failed'));
  };
  const handleMessageError = () => {
    fail(new Error('Rito reader worker sent an unreadable message'));
  };
  attachWorkerListeners(worker, [
    ['message', handleMessage],
    ['error', handleError],
    ['messageerror', handleMessageError],
  ]);
  return createRitoCoreWasmReaderClient(
    sessionId,
    async (input, transfer = []) => {
      if (disposed) throw new Error('Rito reader worker client is disposed');
      if (terminalError) throw terminalError;
      const id = createWorkerRequestId(worker);
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
      disposeRequestId = createWorkerRequestId(worker);
      try {
        if (!finalized) worker.postMessage({ id: disposeRequestId, kind: 'dispose' });
      } catch {
        // A failed post cannot receive an acknowledgement; force termination now.
        terminate();
        return;
      }
      if (!finalized) {
        disposeTimer = globalThis.setTimeout(terminate, WORKER_DISPOSE_ACK_TIMEOUT_MS);
        disposeTimer.unref?.();
      }
    },
    () => disposal.promise,
    sessionCache,
    forceDispose,
  );
}

export function createRitoCoreWasmInProcessReaderClient(module, cache) {
  const sessionId = createReaderSessionId();
  const state = createReaderSessionState();
  const sessionCache = normalizeReaderSessionCache(cache);
  const disposal = createDisposalCompletion();
  return createRitoCoreWasmReaderClient(
    sessionId,
    async (input) => {
      if (input.kind === 'open') {
        return openReaderSessionDocument(
          state,
          () =>
            module.initRitoCoreWasmEngine?.() ??
            Promise.reject(new Error('Rito in-process reader requires the full core module')),
          decodeReaderWorkerOpenRequest(input),
          'Rito in-process reader',
        );
      }
      if (input.kind === 'dispose') {
        return { kind: 'dispose', ...disposeReaderSession(state) };
      }
      if (state.phase === 'disposed') {
        throw new Error('Rito reader in-process client is disposed');
      }
      if (!state.document) throw new Error('Rito in-process reader document is not open');
      return state.document.readerWorkerPayload({ ...input, id: 0 });
    },
    () => {
      try {
        disposeReaderSession(state);
      } finally {
        disposal.resolve();
      }
    },
    () => disposal.promise,
    sessionCache,
  );
}

export function createRitoCoreWasmReaderWorkerHandler(scope, deps) {
  const state = createReaderSessionState();
  scope.addEventListener('message', (event) => {
    void handleWorkerMessage(scope, deps, state, event.data);
  });
}

function createRitoCoreWasmReaderClient(
  sessionId,
  request,
  dispose,
  whenDisposed,
  cache,
  disposeInvalid = dispose,
) {
  let phase = 'idle';
  let activeCache = cache;
  const open = async (data, options) => {
    if (phase !== 'idle') throw new Error(`Rito reader client cannot open while ${phase}`);
    phase = 'opening';
    const openingCache = activeCache;
    try {
      const prepared = prepareReaderWorkerOpen(data, options);
      const publicationIdentity = await prepareReaderSessionCache(openingCache, data);
      if (phase !== 'opening') throw new Error('Rito reader client was disposed while opening');
      const openResult = await requestReaderOpen(request, prepared, () => {
        phase = 'disposed';
        activeCache = normalizeReaderSessionCache();
        disposeInvalid();
      });
      if (phase !== 'opening') throw new Error('Rito reader client was disposed while opening');
      commitReaderSessionCache(
        openingCache,
        publicationIdentity,
        openResult.pinnedFontPolicy.policyId,
        () => {
          phase = 'disposed';
          activeCache = normalizeReaderSessionCache();
          disposeInvalid();
        },
      );
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
    activeCache = normalizeReaderSessionCache();
    dispose();
  };
  const versionedMethods = createVersionedReaderClientMethods(request);
  return {
    sessionId,
    open,
    createViewRevision: (viewRequest) =>
      createCachedReaderViewRevision(activeCache, viewRequest, readerRuntimeWire(), request),
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
    ...versionedMethods,
    dispose: disposeClient,
    whenDisposed,
  };
}

async function requestReaderOpen(request, prepared, disposeInvalid) {
  const payload = await request(prepared.request, prepared.transfer);
  try {
    if (payload.kind !== 'open') {
      throw new Error(`Rito reader worker returned ${payload.kind} for open`);
    }
    return validateReaderWorkerOpenResult(payload.result, prepared.expectedFaces);
  } catch (error) {
    try {
      disposeInvalid();
    } catch {
      // Preserve the worker protocol failure after best-effort cleanup.
    }
    throw error;
  }
}

function createReaderSessionId() {
  const sessionId = `rito-reader-session-${String(nextReaderSessionId)}`;
  nextReaderSessionId += 1;
  return sessionId;
}

function createWorkerRequestId(worker) {
  const id = nextWorkerRequestIds.get(worker) ?? 1;
  nextWorkerRequestIds.set(worker, id + 1);
  return id;
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
      decodeReaderWorkerOpenRequest(request),
      'Rito reader worker',
    );
  }
  if (request.kind === 'dispose') {
    beginReaderSessionRelease(state);
    return { kind: 'dispose', ...releaseReaderSessionDocument(state) };
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
  const revision = recoveryRevision(normalized.code, normalized.revision);
  return {
    name: normalized.name,
    message: normalized.message,
    code: normalized.code,
    ...(revision !== undefined ? { revision } : {}),
  };
}

function workerError(error) {
  const payload = error !== null && typeof error === 'object' ? error : {};
  const code = workerErrorCode(payload.code);
  const revision = recoveryRevision(code, payload.revision);
  const message =
    typeof payload.message === 'string' && payload.message.length > 0
      ? payload.message
      : 'Rito reader worker failed';
  const out = new RitoCoreWasmError(code, message, {
    ...(revision !== undefined ? { revision } : {}),
  });
  out.name =
    typeof payload.name === 'string' && payload.name.length > 0
      ? payload.name
      : 'RitoCoreWasmError';
  return out;
}

function recoveryRevision(code, revision) {
  return code === 'engine-error' &&
    revision?.status === 'failed' &&
    isRitoCoreWasmRevisionSummary(revision)
    ? revision
    : undefined;
}

function workerErrorCode(value) {
  return value === 'bad-request' ||
    value === 'engine-error' ||
    value === 'internal-error' ||
    value === 'unknown-revision' ||
    value === 'stale-revision-version'
    ? value
    : 'internal-error';
}

function isRequest(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return typeof value.id === 'number' && typeof value.kind === 'string';
}

function isResponse(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return typeof value.id === 'number' && typeof value.ok === 'boolean';
}

function responseId(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return typeof value.id === 'number' ? value.id : undefined;
}

function isDisposeAcknowledgement(response, documentOpened) {
  return (
    response.ok === true &&
    response.payload?.kind === 'dispose' &&
    typeof response.payload.releasedDocument === 'boolean' &&
    (!documentOpened || response.payload.releasedDocument)
  );
}

function createDisposalCompletion() {
  let resolve;
  let reject;
  const promise = new Promise((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  void promise.catch(() => undefined);
  return { promise, reject, resolve };
}

function attachWorkerListeners(worker, listeners) {
  const installed = [];
  try {
    for (const [type, listener] of listeners) {
      worker.addEventListener(type, listener);
      installed.push([type, listener]);
    }
  } catch (error) {
    for (const [type, listener] of installed.reverse()) {
      try {
        worker.removeEventListener(type, listener);
      } catch {
        // Preserve the construction error after best-effort listener rollback.
      }
    }
    try {
      worker.terminate();
    } catch {
      // Preserve the construction error after best-effort Worker release.
    }
    throw error;
  }
}

function responseTransfer(payload) {
  switch (payload.kind) {
    case 'createViewRevision':
      return payload.result.result.frameWindow
        ? frameWindowTransfers(payload.result.result.frameWindow)
        : [];
    case 'warmFrameWindow':
      return frameWindowTransfers(payload.result);
    case 'warmFrameWindowAtRevision':
      return frameWindowTransfers(payload.result);
    case 'readResource':
      return [payload.result.bytes.buffer];
    case 'readFrameBufferAtRevision':
    case 'readResourceAtRevision':
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
