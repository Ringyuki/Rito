import {
  copyRitoReaderWireBytesV1,
  decodeRitoReaderArtifactIdentityV1,
} from './reader-v1-artifact-decoder-runtime.js';
import { decodeRitoReaderPublicationV1 } from './reader-v1-publication-runtime.js';
import {
  encodeRitoReaderAdjacentRequestV1,
  encodeRitoReaderArtifactRequestV1,
} from './reader-v1-request-runtime.js';
import {
  decodeRitoReaderForegroundHandoffAckV1,
  encodeRitoReaderForegroundHandoffV1,
} from './reader-v1-foreground-runtime.js';
import {
  decodeRitoReaderBackgroundAdvanceV1,
  decodeRitoReaderBackgroundHandoffAckV1,
  encodeRitoReaderBackgroundHandoffV1,
  encodeRitoReaderBackgroundRequestV1,
} from './reader-v1-background-runtime.js';

const PROTOCOL = 'rito-reader-v1';
const COLD_OPEN_DIAGNOSTIC = 'cold-open-attribution-v1';
const MAX_QUEUED_MESSAGES = 8;
const MAX_LIVE_ARTIFACTS = 4;
const NON_FATAL_EXACT_TERMINAL_CODES = new Set([
  'invalid-request',
  'invalid-layout',
  'invalid-locator',
  'unsupported-text-profile',
  'stale-request',
  'target-not-published',
  'numeric-overflow',
]);

export function createRitoCoreWasmReaderV1WorkerHandler(scope, deps) {
  const state = {
    phase: 'idle',
    session: undefined,
    sessionId: undefined,
    visibleArtifactId: undefined,
    liveArtifacts: new Set(),
    foregroundArtifactRequests: new Map(),
    backgroundCandidates: new Map(),
  };
  let queued = 0;
  let tail = Promise.resolve();
  scope.addEventListener('message', (event) => {
    const message = event.data;
    if (!isRequest(message)) return;
    if (queued >= MAX_QUEUED_MESSAGES) {
      postError(
        scope,
        message.id,
        readerWorkerError('request-capacity', 'Reader request queue is full'),
      );
      return;
    }
    queued += 1;
    tail = tail
      .catch(() => undefined)
      .then(() => handleMessage(state, deps, message))
      .then(
        ({ payload, transfer = [] }) => postSuccess(scope, message.id, payload, transfer),
        (error) => postError(scope, message.id, normalizeWorkerError(error)),
      )
      .catch((error) => {
        try {
          postError(scope, message.id, normalizeWorkerError(error));
        } catch {
          // A dead worker transport has no remaining recovery channel.
        }
      })
      .finally(() => {
        queued -= 1;
      });
  });
}

async function handleMessage(state, deps, message) {
  if (message.kind === 'open') return openSession(state, deps, message);
  if (message.kind === 'dispose') return disposeSession(state);
  requireOpen(state);
  switch (message.kind) {
    case 'read-publication': {
      const raw = state.session.publicationV1();
      const publication = decodeRitoReaderPublicationV1(raw);
      if (publication.sessionId !== state.sessionId) {
        throw readerWorkerError(
          'invalid-wire',
          'Reader publication identity does not match its session',
        );
      }
      const wireBytes = copyRitoReaderWireBytesV1(raw);
      const wire = wireBytes.buffer;
      return { payload: { kind: 'publication', wire }, transfer: [wire] };
    }
    case 'request-artifact':
      state.foregroundArtifactRequests.clear();
      requireArtifactCapacity(state);
      return exactArtifactAttemptResponse(state, message.request, () =>
        state.session.requestArtifactV1(
          encodeRitoReaderArtifactRequestV1(singleQuantumExactRequest(message.request)),
        ),
      );
    case 'request-adjacent':
      state.foregroundArtifactRequests.clear();
      requireArtifactCapacity(state);
      requireOwnedArtifact(state, message.request.fromArtifactId);
      return adjacentArtifactAttemptResponse(
        state,
        singleQuantumAdjacentRequest(message.request),
        (request) => state.session.requestAdjacentV1(encodeRitoReaderAdjacentRequestV1(request)),
      );
    case 'adopt-foreground-candidate':
      requireOwnedArtifact(state, message.request.candidateArtifactId);
      return foregroundHandoffResponse(
        state,
        message.request,
        state.session.adoptForegroundCandidateV1(
          encodeRitoReaderForegroundHandoffV1(message.request),
        ),
      );
    case 'advance-background-once':
      requireVisibleArtifact(state, message.request.expectedVisibleArtifactId);
      if (!hasPendingCandidate(state, message.request.expectedVisibleArtifactId)) {
        requireArtifactCapacity(state);
      }
      return backgroundAdvanceResponse(
        state,
        message.request,
        state.session.advanceBackgroundOnceV1(encodeRitoReaderBackgroundRequestV1(message.request)),
      );
    case 'adopt-background-candidate':
      requireVisibleArtifact(state, message.request.expectedVisibleArtifactId);
      requirePendingCandidate(
        state,
        message.request.expectedVisibleArtifactId,
        message.request.candidateArtifactId,
      );
      return backgroundHandoffResponse(
        state,
        message.request,
        state.session.adoptBackgroundCandidateV1(
          encodeRitoReaderBackgroundHandoffV1(message.request),
        ),
      );
    case 'read-resource': {
      requireOwnedArtifact(state, message.artifactId);
      const raw = state.session.readResourceV1(
        message.artifactId,
        resourceKindTag(message.resourceKind),
        message.href,
      );
      const wire = standaloneBuffer(raw);
      return { payload: { kind: 'resource', wire }, transfer: [wire] };
    }
    case 'release': {
      const released = state.session.releaseArtifactV1(message.artifactId);
      state.liveArtifacts.delete(message.artifactId);
      state.foregroundArtifactRequests.delete(message.artifactId);
      state.backgroundCandidates.delete(message.artifactId);
      if (state.visibleArtifactId === message.artifactId) state.visibleArtifactId = undefined;
      return { payload: { kind: 'release', released } };
    }
    default:
      throw readerWorkerError(
        'invalid-request',
        `Unknown Reader v1 request: ${String(message.kind)}`,
      );
  }
}

async function openSession(state, deps, message) {
  if (state.phase !== 'idle') {
    throw readerWorkerError('invalid-session', `Reader cannot open while ${state.phase}`);
  }
  state.phase = 'opening';
  try {
    if (message.diagnostics === COLD_OPEN_DIAGNOSTIC) {
      return await openSessionWithColdDiagnostic(state, deps, message);
    }
    await deps.initRitoCoreWasm();
    const publication = new Uint8Array(message.publication);
    state.session = new deps.RitoReaderSessionV1(publication, message.sessionId);
    state.sessionId = message.sessionId;
    state.phase = 'open';
    return exactArtifactAttemptResponse(
      state,
      message.request,
      () =>
        state.session.requestArtifactV1(
          encodeRitoReaderArtifactRequestV1(singleQuantumExactRequest(message.request)),
        ),
      'open',
    );
  } catch (error) {
    if (state.phase !== 'disposed') disposeTerminalSession(state);
    throw error;
  }
}

async function openSessionWithColdDiagnostic(state, deps, message) {
  const startedAt = diagnosticNow();
  const workerOpenHandlerStartedEpochMs = diagnosticEpochNow();
  const segments = Object.create(null);
  segments.wasmInitMs = await measureDiagnosticAsync(() => deps.initRitoCoreWasm());
  const publication = new Uint8Array(message.publication);
  [state.session, segments.epubOpenParsePublicationMetadataMs] = measureDiagnostic(
    () => new deps.RitoReaderSessionV1(publication, message.sessionId),
  );
  state.sessionId = message.sessionId;
  state.phase = 'open';
  const [requestWire, requestWireEncodeMs] = measureDiagnostic(() =>
    encodeRitoReaderArtifactRequestV1(singleQuantumExactRequest(message.request)),
  );
  segments.requestWireEncodeMs = requestWireEncodeMs;
  const [raw, requestArtifactMs] = measureDiagnostic(() =>
    state.session.requestArtifactV1(requestWire),
  );
  segments.requestArtifactStyleLayoutPaginationDisplayListWireMs = requestArtifactMs;
  if (hasPendingExactSeek(state)) {
    throw readerWorkerError(
      'invalid-wire',
      'Cold-open attribution requires one exact Ready Core attempt',
    );
  }
  const [response, artifactWireCopyIdentityMs] = measureDiagnostic(() =>
    artifactResponse(state, message.request, raw, 'open'),
  );
  segments.artifactWireCopyIdentityMs = artifactWireCopyIdentityMs;
  const workerOpenHandlerMs = diagnosticNow() - startedAt;
  const workerOpenHandlerFinishedEpochMs = diagnosticEpochNow();
  const attributedMs = Object.values(segments).reduce((sum, value) => sum + value, 0);
  return {
    ...response,
    payload: {
      ...response.payload,
      diagnostics: {
        protocol: COLD_OPEN_DIAGNOSTIC,
        singleCoreAttemptRequired: true,
        workerOpenHandlerStartedEpochMs,
        workerOpenHandlerFinishedEpochMs,
        workerOpenHandlerMs,
        ...segments,
        workerJsOverheadMs: Math.max(0, workerOpenHandlerMs - attributedMs),
      },
    },
  };
}

function measureDiagnostic(operation) {
  const start = diagnosticNow();
  const value = operation();
  return [value, diagnosticNow() - start];
}

async function measureDiagnosticAsync(operation) {
  const start = diagnosticNow();
  await operation();
  return diagnosticNow() - start;
}

function diagnosticNow() {
  return globalThis.performance.now();
}

function diagnosticEpochNow() {
  return globalThis.performance.timeOrigin + globalThis.performance.now();
}

function exactArtifactAttemptResponse(state, request, attempt, kind = 'artifact') {
  let raw;
  try {
    raw = attempt();
  } catch (error) {
    const normalized = normalizeWorkerError(error);
    if (normalized.code === 'target-not-published' && hasPendingExactSeek(state)) {
      return pendingExactResponse(request);
    }
    if (kind === 'open' || isFatalExactError(normalized.code)) disposeTerminalSession(state);
    throw error;
  }
  if (hasPendingExactSeek(state)) {
    disposeTerminalSession(state);
    throw readerWorkerError(
      'invalid-wire',
      'Core returned an artifact while an exact seek was still pending',
    );
  }
  try {
    return artifactResponse(state, request, raw, kind);
  } catch (error) {
    const normalized = normalizeWorkerError(error);
    if (kind === 'open' || isFatalExactError(normalized.code)) disposeTerminalSession(state);
    throw error;
  }
}

function adjacentArtifactAttemptResponse(state, request, attempt) {
  let raw;
  try {
    raw = attempt(request);
  } catch (error) {
    const normalized = normalizeWorkerError(error);
    if (normalized.code === 'target-not-published' && hasPendingAdjacent(state)) {
      return pendingAdjacentResponse(request);
    }
    if (isFatalExactError(normalized.code)) disposeTerminalSession(state);
    throw error;
  }
  if (hasPendingAdjacent(state)) {
    disposeTerminalSession(state);
    throw readerWorkerError(
      'invalid-wire',
      'Core returned an artifact while adjacent work was still pending',
    );
  }
  try {
    return artifactResponse(state, request, raw);
  } catch (error) {
    disposeTerminalSession(state);
    throw error;
  }
}

function isFatalExactError(code) {
  return !NON_FATAL_EXACT_TERMINAL_CODES.has(code);
}

function singleQuantumExactRequest(request) {
  return {
    ...request,
    work: { ...request.work, maxForegroundQuanta: 1 },
  };
}

function singleQuantumAdjacentRequest(request) {
  return {
    ...request,
    work: { ...request.work, maxForegroundQuanta: 1 },
  };
}

function pendingExactResponse(request) {
  return {
    payload: {
      kind: 'pending-exact',
      sessionId: request.sessionId,
      requestId: request.requestId,
    },
  };
}

function pendingAdjacentResponse(request) {
  return {
    payload: {
      kind: 'pending-adjacent',
      sessionId: request.sessionId,
      requestId: request.requestId,
      fromArtifactId: request.fromArtifactId,
      direction: request.direction,
    },
  };
}

function hasPendingExactSeek(state) {
  const query = state.session?.hasPendingExactSeekV1;
  return typeof query === 'function' && query.call(state.session) === true;
}

function hasPendingAdjacent(state) {
  const query = state.session?.hasPendingAdjacentV1;
  return typeof query === 'function' && query.call(state.session) === true;
}

function disposeTerminalSession(state) {
  try {
    releaseRawSession(state);
  } finally {
    state.phase = 'disposed';
  }
}

// A mutating Core call has already committed before its result wire is read;
// an unreadable result therefore reports indeterminate engine state instead of
// a malformed request, and the session fails closed.
function decodeMutationResult(raw, decode, description) {
  try {
    const wireBytes = copyRitoReaderWireBytesV1(raw);
    return [wireBytes, decode(wireBytes)];
  } catch {
    throw readerWorkerError(
      'engine-failure',
      `${description} is unreadable after the Core mutation was applied`,
    );
  }
}

function artifactResponse(state, request, raw, kind = 'artifact') {
  const [wireBytes, identity] = decodeMutationResult(
    raw,
    decodeRitoReaderArtifactIdentityV1,
    'Reader artifact wire',
  );
  if (identity.sessionId !== state.sessionId || identity.requestId !== request.requestId) {
    try {
      state.session.releaseArtifactV1(identity.artifactId);
    } catch {
      // Preserve the protocol identity error and let session disposal release the remainder.
    }
    throw readerWorkerError('invalid-wire', 'Reader artifact identity does not match its request');
  }
  state.liveArtifacts.add(identity.artifactId);
  state.foregroundArtifactRequests.set(identity.artifactId, identity.requestId);
  const wire = wireBytes.buffer;
  return { payload: { kind, identity, wire }, transfer: [wire] };
}

function foregroundHandoffResponse(state, request, raw) {
  try {
    const [wireBytes, ack] = decodeMutationResult(
      raw,
      decodeRitoReaderForegroundHandoffAckV1,
      'Foreground handoff acknowledgement wire',
    );
    const candidateRequestId = state.foregroundArtifactRequests.get(request.candidateArtifactId);
    if (
      candidateRequestId === undefined ||
      state.visibleArtifactId !== request.expectedVisibleArtifactId ||
      ack.intentRequestId !== candidateRequestId ||
      ack.replacedArtifactId !== request.expectedVisibleArtifactId ||
      ack.visibleArtifactId !== request.candidateArtifactId
    ) {
      throw readerWorkerError('invalid-wire', 'Foreground handoff acknowledgement is invalid');
    }
    state.visibleArtifactId = request.candidateArtifactId;
    state.foregroundArtifactRequests.clear();
    const wire = wireBytes.buffer;
    return { payload: { kind: 'foreground-handoff', wire }, transfer: [wire] };
  } catch (error) {
    disposeTerminalSession(state);
    throw error;
  }
}

function backgroundAdvanceResponse(state, request, raw) {
  try {
    const [wireBytes, advance] = decodeMutationResult(
      raw,
      decodeRitoReaderBackgroundAdvanceV1,
      'Background advance wire',
    );
    const candidate = advance.artifact;
    if (advance.replacesArtifactId !== request.expectedVisibleArtifactId) {
      releaseInvalidCandidate(state, candidate);
      throw readerWorkerError('invalid-wire', 'Background replacement identity is invalid');
    }
    if (candidate) {
      const candidateIsValid =
        candidate.sessionId === state.sessionId &&
        candidate.requestId === advance.intentRequestId &&
        !state.liveArtifacts.has(candidate.artifactId) &&
        state.liveArtifacts.size < MAX_LIVE_ARTIFACTS &&
        !hasPendingCandidate(state, request.expectedVisibleArtifactId);
      if (!candidateIsValid) {
        releaseInvalidCandidate(state, candidate);
        throw readerWorkerError('invalid-wire', 'Background candidate identity is invalid');
      }
      state.liveArtifacts.add(candidate.artifactId);
      state.backgroundCandidates.set(candidate.artifactId, {
        expectedVisibleArtifactId: request.expectedVisibleArtifactId,
        intentRequestId: advance.intentRequestId,
      });
    }
    const wire = wireBytes.buffer;
    return {
      payload: {
        kind: 'background-advance',
        candidateIdentity: candidate ? artifactIdentity(candidate) : undefined,
        wire,
      },
      transfer: [wire],
    };
  } catch (error) {
    disposeTerminalSession(state);
    throw error;
  }
}

function backgroundHandoffResponse(state, request, raw) {
  try {
    const [wireBytes, ack] = decodeMutationResult(
      raw,
      decodeRitoReaderBackgroundHandoffAckV1,
      'Background handoff acknowledgement wire',
    );
    const candidate = state.backgroundCandidates.get(request.candidateArtifactId);
    if (
      !candidate ||
      ack.intentRequestId !== candidate.intentRequestId ||
      ack.replacedArtifactId !== request.expectedVisibleArtifactId ||
      ack.visibleArtifactId !== request.candidateArtifactId
    ) {
      throw readerWorkerError('invalid-wire', 'Background handoff acknowledgement is invalid');
    }
    state.visibleArtifactId = request.candidateArtifactId;
    state.foregroundArtifactRequests.clear();
    state.backgroundCandidates.delete(request.candidateArtifactId);
    const wire = wireBytes.buffer;
    return { payload: { kind: 'background-handoff', wire }, transfer: [wire] };
  } catch (error) {
    disposeTerminalSession(state);
    throw error;
  }
}

function disposeSession(state) {
  const releasedArtifacts = state.liveArtifacts.size;
  const sessionId = state.sessionId;
  try {
    releaseRawSession(state);
  } finally {
    state.phase = 'disposed';
  }
  return { payload: { kind: 'dispose', releasedArtifacts, sessionId } };
}

function releaseRawSession(state) {
  const session = state.session;
  state.session = undefined;
  state.visibleArtifactId = undefined;
  state.liveArtifacts.clear();
  state.foregroundArtifactRequests.clear();
  state.backgroundCandidates.clear();
  if (!session) return;
  try {
    session.disposeV1();
  } finally {
    session.free?.();
  }
}

function requireOpen(state) {
  if (state.phase !== 'open' || !state.session) {
    throw readerWorkerError('session-disposed', 'Reader session is not open');
  }
}

function requireArtifactCapacity(state) {
  if (state.liveArtifacts.size >= MAX_LIVE_ARTIFACTS) {
    throw readerWorkerError(
      'artifact-capacity',
      `Reader retains at most ${String(MAX_LIVE_ARTIFACTS)} artifacts`,
    );
  }
}

function requireOwnedArtifact(state, artifactId) {
  if (!state.liveArtifacts.has(artifactId)) {
    throw readerWorkerError('unknown-artifact', 'Reader artifact is not live in this worker');
  }
}

function requireVisibleArtifact(state, artifactId) {
  if (state.visibleArtifactId !== artifactId) {
    throw readerWorkerError(
      'stale-request',
      'Background guard is not the current visible artifact',
    );
  }
  requireOwnedArtifact(state, artifactId);
}

function requirePendingCandidate(state, expectedVisibleArtifactId, candidateArtifactId) {
  requireOwnedArtifact(state, candidateArtifactId);
  const candidate = state.backgroundCandidates.get(candidateArtifactId);
  if (!candidate || candidate.expectedVisibleArtifactId !== expectedVisibleArtifactId) {
    throw readerWorkerError('stale-request', 'Background candidate is not pending for this intent');
  }
}

function hasPendingCandidate(state, expectedVisibleArtifactId) {
  for (const [artifactId, candidate] of state.backgroundCandidates) {
    if (
      candidate.expectedVisibleArtifactId === expectedVisibleArtifactId &&
      state.liveArtifacts.has(artifactId)
    ) {
      return true;
    }
  }
  return false;
}

function releaseInvalidCandidate(state, candidate) {
  if (!candidate || state.liveArtifacts.has(candidate.artifactId)) return;
  try {
    state.session.releaseArtifactV1(candidate.artifactId);
  } catch {
    // Preserve the wire violation; disposal remains the final ownership backstop.
  }
}

function artifactIdentity(artifact) {
  return {
    sessionId: artifact.sessionId,
    requestId: artifact.requestId,
    revisionId: artifact.revisionId,
    revisionVersion: artifact.revisionVersion,
    artifactId: artifact.artifactId,
  };
}

function resourceKindTag(kind) {
  if (kind === 'image') return 0;
  if (kind === 'font') return 1;
  if (kind === 'stylesheet') return 2;
  throw readerWorkerError('invalid-request', `Unknown Reader v1 resource kind: ${String(kind)}`);
}

function standaloneBuffer(value) {
  return copyRitoReaderWireBytesV1(value).buffer;
}

function isRequest(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.protocol === PROTOCOL &&
    Number.isSafeInteger(value.id) &&
    value.id > 0 &&
    typeof value.kind === 'string'
  );
}

function postSuccess(scope, id, payload, transfer) {
  scope.postMessage({ protocol: PROTOCOL, id, ok: true, payload }, transfer);
}

function postError(scope, id, error) {
  scope.postMessage({ protocol: PROTOCOL, id, ok: false, error });
}

function normalizeWorkerError(error) {
  const value = error !== null && typeof error === 'object' ? error : {};
  return {
    name: typeof value.name === 'string' ? value.name : 'RitoReaderErrorV1',
    code: typeof value.code === 'string' ? value.code : 'engine-failure',
    message: typeof value.message === 'string' ? value.message : String(error),
  };
}

function readerWorkerError(code, message) {
  return { name: 'RitoReaderErrorV1', code, message };
}
