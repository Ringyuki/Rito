import {
  decodeRitoReaderArtifactV1,
  decodeRitoReaderResourceV1,
} from './reader-v1-artifact-decoder-runtime.js';
import {
  decodeRitoReaderBackgroundAdvanceV1,
  decodeRitoReaderBackgroundHandoffAckV1,
} from './reader-v1-background-runtime.js';
import { decodeRitoReaderPublicationV1 } from './reader-v1-publication-runtime.js';
import { decodeRitoReaderForegroundHandoffAckV1 } from './reader-v1-foreground-runtime.js';
import { defaultYieldControl } from './reader-bounded-session-support-runtime.js';

const PROTOCOL = 'rito-reader-v1';
const MAX_PENDING_MESSAGES = 8;
const MAX_EXACT_CONTINUATION_QUANTA = 4_096;
const MAX_ADJACENT_CONTINUATION_QUANTA = 4_096;
const DISPOSE_TIMEOUT_MS = 1_000;
const ERROR_CODES = new Set([
  'invalid-session',
  'invalid-request',
  'invalid-layout',
  'invalid-locator',
  'unsupported-text-profile',
  'stale-request',
  'target-not-published',
  'unknown-artifact',
  'numeric-overflow',
  'invalid-wire',
  'engine-failure',
  'session-disposed',
  'request-busy',
  'request-capacity',
  'artifact-capacity',
]);
let nextSessionId = 1n;

export class RitoReaderErrorV1 extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RitoReaderErrorV1';
    this.code = code;
  }
}

export function createRitoCoreWasmReaderV1WorkerClient(worker, options = {}) {
  const sessionId = allocateSessionId();
  const yieldControl = options.yieldControl ?? defaultYieldControl;
  const exactContinuationLimit = requireExactContinuationLimit(
    options.maxExactContinuationQuanta ?? MAX_EXACT_CONTINUATION_QUANTA,
  );
  const adjacentContinuationLimit = requireAdjacentContinuationLimit(
    options.maxAdjacentContinuationQuanta ?? MAX_ADJACENT_CONTINUATION_QUANTA,
  );
  const pending = new Map();
  const liveArtifacts = new Set();
  const backgroundCandidates = new Map();
  const inFlightReleases = new Map();
  let requestId = 0n;
  let messageId = 0;
  let phase = 'idle';
  let terminalError;
  let requestTemplate;
  let foregroundCandidate;
  let activeSeek;
  let queuedSeek;
  let foregroundGeneration = 0;
  let foregroundOperations = 0;
  let foregroundTail = Promise.resolve();
  let backgroundActive = false;
  let backgroundIdle = Promise.resolve();
  let finishBackground;
  let visibleArtifactId;
  let disposeCompletion;

  const handleMessage = (event) => {
    const response = event.data;
    if (!isResponse(response)) return;
    if (response.payload?.kind === 'dispose' && disposeCompletion) {
      disposeCompletion.resolve();
      return;
    }
    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    if (response.ok) entry.resolve(response.payload);
    else entry.reject(responseError(response.error));
  };
  const fail = (error) => {
    terminalError ??= error instanceof Error ? error : new Error(String(error));
    phase = 'disposed';
    activeSeek?.deferred.reject(terminalError);
    queuedSeek?.deferred.reject(terminalError);
    activeSeek = undefined;
    queuedSeek = undefined;
    foregroundCandidate = undefined;
    rejectPending(terminalError);
    detach();
    terminate(worker);
  };
  const handleError = (event) => fail(new Error(event.message || 'Reader v1 worker failed'));
  const handleMessageError = () => fail(new Error('Reader v1 worker sent an unreadable message'));
  worker.addEventListener('message', handleMessage);
  worker.addEventListener('error', handleError);
  worker.addEventListener('messageerror', handleMessageError);

  const send = (kind, body, transfer = []) => {
    requireUsable();
    if (pending.size >= MAX_PENDING_MESSAGES) {
      return Promise.reject(
        new RitoReaderErrorV1('request-capacity', 'Reader v1 pending message limit reached'),
      );
    }
    messageId += 1;
    const id = messageId;
    const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    try {
      worker.postMessage({ protocol: PROTOCOL, id, kind, ...body }, transfer);
    } catch (error) {
      pending.delete(id);
      return Promise.reject(error);
    }
    return promise;
  };

  const open = async (publication, request, pinnedFontPolicy) => {
    if (phase !== 'idle') throw new RitoReaderErrorV1('invalid-session', `Reader is ${phase}`);
    if (!(publication instanceof ArrayBuffer)) {
      throw new TypeError('Reader publication must be a dedicated ArrayBuffer');
    }
    phase = 'opening';
    const attemptLimit = exactContinuationLimit;
    let attempts = 1;
    let fullRequest = nextExactRequest(request);
    try {
      let payload = await send(
        'open',
        { publication, sessionId, request: fullRequest, pinnedFontPolicy },
        [publication],
      );
      while (isPendingExactPayload(payload, fullRequest)) {
        if (attempts >= attemptLimit) throw exactContinuationLimitError(attemptLimit);
        await yieldControl();
        if (phase !== 'opening') throw sessionDisposedError();
        fullRequest = nextExactRequest(request);
        attempts += 1;
        payload = await send('request-artifact', { request: fullRequest });
      }
      const artifact = decodeArtifactPayload(payload, fullRequest);
      liveArtifacts.add(artifact.artifactId);
      foregroundCandidate = foregroundCandidateIdentity(artifact, request);
      phase = 'open';
      return artifact;
    } catch (error) {
      await dispose().catch(() => undefined);
      throw error;
    }
  };

  const nextExactRequest = (request) =>
    withRequestIdentity(
      {
        ...request,
        work: { ...request.work, maxForegroundQuanta: 1 },
      },
      sessionId,
      nextRequestId(),
    );

  const nextForegroundIntent = () => {
    foregroundGeneration += 1;
    foregroundCandidate = undefined;
    return foregroundGeneration;
  };

  const supersedeSeeks = () => {
    if (activeSeek) {
      activeSeek.superseded = true;
      activeSeek.deferred.reject(staleRequestError());
    }
    if (queuedSeek) {
      queuedSeek.deferred.reject(staleRequestError());
      queuedSeek = undefined;
    }
  };

  const runInForegroundLane = async (run) => {
    const previous = foregroundTail;
    let release;
    foregroundOperations += 1;
    foregroundTail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    await backgroundIdle;
    try {
      return await run();
    } finally {
      foregroundOperations -= 1;
      release();
    }
  };

  const requestAdjacent = async (fromArtifactId, direction, work = requestTemplate?.work) => {
    requireOpen();
    if (!liveArtifacts.has(fromArtifactId)) {
      throw new RitoReaderErrorV1('unknown-artifact', 'Adjacent source artifact is not live');
    }
    if (!work) throw new RitoReaderErrorV1('invalid-request', 'Adjacent work budget is required');
    const intentId = nextForegroundIntent();
    supersedeSeeks();
    try {
      return await runInForegroundLane(async () => {
        let attempts = 0;
        while (phase === 'open' && intentId === foregroundGeneration) {
          if (attempts >= adjacentContinuationLimit) {
            throw adjacentContinuationLimitError(adjacentContinuationLimit);
          }
          attempts += 1;
          const request = {
            sessionId,
            requestId: nextRequestId(),
            fromArtifactId,
            direction,
            work: { ...work, maxForegroundQuanta: 1 },
          };
          const payload = await send('request-adjacent', { request });
          if (isPendingAdjacentPayload(payload, request)) {
            if (intentId !== foregroundGeneration || phase !== 'open') break;
            await yieldControl();
            continue;
          }
          const artifact = decodeArtifactPayload(payload, request);
          liveArtifacts.add(artifact.artifactId);
          if (intentId !== foregroundGeneration || phase !== 'open') {
            await releaseInternal(artifact.artifactId);
            throw staleRequestError();
          }
          foregroundCandidate = foregroundCandidateIdentity(artifact);
          return artifact;
        }
        if (phase !== 'open') throw sessionDisposedError();
        throw staleRequestError();
      });
    } catch (error) {
      if (phase !== 'disposed' && isFatalSessionError(error)) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    }
  };

  const readPublication = async () => {
    requireOpen();
    const payload = await send('read-publication', {});
    if (payload?.kind !== 'publication') throw invalidPayload('publication');
    const publication = decodeRitoReaderPublicationV1(payload.wire);
    if (publication.sessionId !== sessionId) {
      throw new RitoReaderErrorV1(
        'invalid-wire',
        'Publication response identity does not match the session',
      );
    }
    return publication;
  };

  const requestArtifact = (request) => {
    requireOpen();
    const deferred = createDeferred();
    const operation = {
      deferred,
      request,
      intentId: nextForegroundIntent(),
      superseded: false,
    };
    if (activeSeek) {
      activeSeek.superseded = true;
      activeSeek.deferred.reject(staleRequestError());
      if (queuedSeek) queuedSeek.deferred.reject(staleRequestError());
      queuedSeek = operation;
    } else {
      activeSeek = operation;
      void runActiveSeek();
    }
    return deferred.promise;
  };

  const runActiveSeek = async () => {
    const operation = activeSeek;
    if (!operation) return;
    let staleArtifact;
    try {
      await runInForegroundLane(async () => {
        const attemptLimit = exactContinuationLimit;
        let attempts = 0;
        while (
          phase === 'open' &&
          !operation.superseded &&
          operation.intentId === foregroundGeneration
        ) {
          if (attempts >= attemptLimit) {
            const error = exactContinuationLimitError(attemptLimit);
            operation.deferred.reject(error);
            await dispose().catch(() => undefined);
            return;
          }
          attempts += 1;
          const request = nextExactRequest(operation.request);
          const payload = await send('request-artifact', { request });
          if (isPendingExactPayload(payload, request)) {
            if (operation.superseded || phase !== 'open') break;
            await yieldControl();
            continue;
          }
          const artifact = decodeArtifactPayload(payload, request);
          liveArtifacts.add(artifact.artifactId);
          if (operation.superseded || phase !== 'open') {
            staleArtifact = artifact;
            await releaseInternal(artifact.artifactId);
          } else {
            foregroundCandidate = foregroundCandidateIdentity(artifact, operation.request);
            operation.deferred.resolve(artifact);
          }
          break;
        }
      });
    } catch (error) {
      if (
        phase !== 'disposed' &&
        ((operation.superseded && staleArtifact) || isFatalSessionError(error))
      ) {
        fail(error instanceof Error ? error : new Error(String(error)));
      } else {
        operation.deferred.reject(error);
      }
    } finally {
      if (activeSeek === operation) activeSeek = undefined;
      if (queuedSeek && phase === 'open') {
        activeSeek = queuedSeek;
        queuedSeek = undefined;
        void runActiveSeek();
      }
    }
  };

  const seek = (locator, overrides = {}) => {
    requireOpen();
    if (!requestTemplate)
      throw new RitoReaderErrorV1('invalid-session', 'Reader has no request template');
    return requestArtifact({
      layout: overrides.layout ?? requestTemplate.layout,
      locator,
      work: overrides.work ?? requestTemplate.work,
      textProfile: overrides.textProfile ?? requestTemplate.textProfile,
    });
  };

  const adoptForegroundCandidate = async (expectedVisibleArtifactId, candidateArtifactId) => {
    requireOpen();
    const candidate = requireForegroundCandidate(expectedVisibleArtifactId, candidateArtifactId);
    return runInForegroundLane(async () => {
      requireForegroundCandidate(expectedVisibleArtifactId, candidateArtifactId, candidate);
      const request = { sessionId, expectedVisibleArtifactId, candidateArtifactId };
      try {
        const payload = await send('adopt-foreground-candidate', { request });
        if (payload?.kind !== 'foreground-handoff') throw invalidPayload('foreground handoff');
        const ack = decodeRitoReaderForegroundHandoffAckV1(payload.wire);
        if (
          ack.intentRequestId !== candidate.requestId ||
          ack.replacedArtifactId !== expectedVisibleArtifactId ||
          ack.visibleArtifactId !== candidateArtifactId
        ) {
          throw new RitoReaderErrorV1(
            'invalid-wire',
            'Foreground handoff acknowledgement does not match its request',
          );
        }
        visibleArtifactId = candidateArtifactId;
        if (candidate.requestTemplate !== undefined) requestTemplate = candidate.requestTemplate;
        foregroundCandidate = undefined;
        return ack;
      } catch (error) {
        if (phase !== 'disposed' && isFatalSessionError(error)) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
        throw error;
      }
    });
  };

  const readResource = async (artifactId, resourceKind, href) => {
    requireOpen();
    if (!liveArtifacts.has(artifactId)) {
      throw new RitoReaderErrorV1('unknown-artifact', 'Resource artifact is not live');
    }
    const payload = await send('read-resource', { artifactId, resourceKind, href });
    if (payload?.kind !== 'resource') throw invalidPayload('resource');
    const resource = decodeRitoReaderResourceV1(payload.wire);
    if (
      resource.artifactId !== artifactId ||
      resource.kind !== resourceKind ||
      resource.href !== href
    ) {
      throw new RitoReaderErrorV1(
        'invalid-wire',
        'Resource response identity does not match request',
      );
    }
    return resource;
  };

  const advanceBackgroundOnce = async (expectedVisibleArtifactId, maxTopLevelNodesPerQuantum) => {
    requireOpen();
    requireVisibleArtifact(expectedVisibleArtifactId);
    requireBackgroundIdle();
    beginBackgroundOperation();
    const request = {
      sessionId,
      expectedVisibleArtifactId,
      maxTopLevelNodesPerQuantum,
    };
    try {
      const payload = await send('advance-background-once', { request });
      if (payload?.kind !== 'background-advance') throw invalidPayload('background advance');
      let advance;
      try {
        advance = decodeRitoReaderBackgroundAdvanceV1(payload.wire);
      } catch (error) {
        await releaseCandidateIdentity(payload.candidateIdentity);
        throw error;
      }
      if (advance.replacesArtifactId !== expectedVisibleArtifactId) {
        await releaseBackgroundArtifact(advance.artifact);
        throw new RitoReaderErrorV1(
          'invalid-wire',
          'Background replacement identity does not match its request',
        );
      }
      await validateBackgroundCandidate(advance, payload.candidateIdentity);
      if (advance.artifact) {
        liveArtifacts.add(advance.artifact.artifactId);
        backgroundCandidates.set(advance.artifact.artifactId, {
          expectedVisibleArtifactId,
          intentRequestId: advance.intentRequestId,
        });
      }
      return advance;
    } catch (error) {
      if (phase !== 'disposed' && isFatalSessionError(error)) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    } finally {
      endBackgroundOperation();
    }
  };

  const adoptBackgroundCandidate = async (expectedVisibleArtifactId, candidateArtifactId) => {
    requireOpen();
    requireVisibleArtifact(expectedVisibleArtifactId);
    requireBackgroundIdle();
    const candidate = backgroundCandidates.get(candidateArtifactId);
    if (
      !candidate ||
      candidate.expectedVisibleArtifactId !== expectedVisibleArtifactId ||
      !liveArtifacts.has(candidateArtifactId)
    ) {
      throw new RitoReaderErrorV1(
        'stale-request',
        'Background candidate is not pending for the visible intent',
      );
    }
    beginBackgroundOperation();
    try {
      const request = { sessionId, expectedVisibleArtifactId, candidateArtifactId };
      const payload = await send('adopt-background-candidate', { request });
      if (payload?.kind !== 'background-handoff') throw invalidPayload('background handoff');
      const ack = decodeRitoReaderBackgroundHandoffAckV1(payload.wire);
      if (
        ack.intentRequestId !== candidate.intentRequestId ||
        ack.replacedArtifactId !== expectedVisibleArtifactId ||
        ack.visibleArtifactId !== candidateArtifactId
      ) {
        throw new RitoReaderErrorV1(
          'invalid-wire',
          'Background handoff acknowledgement does not match its request',
        );
      }
      visibleArtifactId = candidateArtifactId;
      foregroundCandidate = undefined;
      backgroundCandidates.delete(candidateArtifactId);
      return ack;
    } catch (error) {
      if (phase !== 'disposed' && isFatalSessionError(error)) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    } finally {
      endBackgroundOperation();
    }
  };

  const releaseInternal = (artifactId) => {
    const inFlight = inFlightReleases.get(artifactId);
    if (inFlight) return inFlight;
    const operation = performRelease(artifactId).finally(() => {
      if (inFlightReleases.get(artifactId) === operation) {
        inFlightReleases.delete(artifactId);
      }
    });
    inFlightReleases.set(artifactId, operation);
    return operation;
  };

  const performRelease = async (artifactId) => {
    const expectedLive = liveArtifacts.has(artifactId);
    try {
      const payload = await send('release', { artifactId });
      if (payload?.kind !== 'release' || typeof payload.released !== 'boolean') {
        throw invalidPayload('release');
      }
      if (expectedLive && !payload.released) {
        throw new RitoReaderErrorV1(
          'invalid-wire',
          'Release acknowledgement contradicts client artifact ownership',
        );
      }
      liveArtifacts.delete(artifactId);
      if (foregroundCandidate?.artifactId === artifactId) foregroundCandidate = undefined;
      backgroundCandidates.delete(artifactId);
      if (visibleArtifactId === artifactId) visibleArtifactId = undefined;
      return payload.released;
    } catch (error) {
      if (phase !== 'disposed' && isFatalSessionError(error)) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    }
  };

  const release = (artifactId) => {
    requireOpen();
    return releaseInternal(artifactId);
  };

  const dispose = async () => {
    if (phase === 'disposed') return;
    phase = 'disposed';
    const disposedError = new RitoReaderErrorV1(
      'session-disposed',
      'Reader v1 session is disposed',
    );
    activeSeek?.deferred.reject(disposedError);
    queuedSeek?.deferred.reject(disposedError);
    activeSeek = undefined;
    queuedSeek = undefined;
    foregroundCandidate = undefined;
    rejectPending(disposedError);
    disposeCompletion = createDeferred();
    messageId += 1;
    try {
      worker.postMessage({ protocol: PROTOCOL, id: messageId, kind: 'dispose' });
    } catch {
      disposeCompletion.resolve();
    }
    const timer = globalThis.setTimeout(() => disposeCompletion.resolve(), DISPOSE_TIMEOUT_MS);
    timer.unref?.();
    await disposeCompletion.promise;
    globalThis.clearTimeout(timer);
    detach();
    terminate(worker);
    liveArtifacts.clear();
    backgroundCandidates.clear();
    visibleArtifactId = undefined;
  };

  function decodeArtifactPayload(payload, expected) {
    if ((payload?.kind !== 'open' && payload?.kind !== 'artifact') || !payload.identity) {
      throw invalidPayload('artifact');
    }
    let artifact;
    try {
      artifact = decodeRitoReaderArtifactV1(payload.wire);
    } catch (error) {
      void bestEffortRelease(payload.identity.artifactId);
      throw error;
    }
    if (
      artifact.sessionId !== expected.sessionId ||
      artifact.requestId !== expected.requestId ||
      artifact.artifactId !== payload.identity.artifactId ||
      artifact.revisionId !== payload.identity.revisionId ||
      artifact.revisionVersion !== payload.identity.revisionVersion
    ) {
      void bestEffortRelease(artifact.artifactId);
      throw new RitoReaderErrorV1(
        'invalid-wire',
        'Artifact response identity does not match request',
      );
    }
    return artifact;
  }

  async function bestEffortRelease(artifactId) {
    try {
      await releaseInternal(artifactId);
    } catch {
      fail(new RitoReaderErrorV1('engine-failure', 'Failed to release an invalid artifact'));
    }
  }

  async function releaseCandidateIdentity(identity) {
    if (!validArtifactIdentity(identity) || liveArtifacts.has(identity.artifactId)) return;
    await bestEffortRelease(identity.artifactId);
  }

  async function releaseBackgroundArtifact(artifact) {
    if (!artifact || liveArtifacts.has(artifact.artifactId)) return;
    await bestEffortRelease(artifact.artifactId);
  }

  async function validateBackgroundCandidate(advance, identity) {
    const artifact = advance.artifact;
    if (!artifact) {
      if (identity !== undefined) {
        await releaseCandidateIdentity(identity);
        throw invalidPayload('background candidate identity');
      }
      return;
    }
    if (
      !validArtifactIdentity(identity) ||
      artifact.sessionId !== sessionId ||
      artifact.requestId !== advance.intentRequestId ||
      artifact.sessionId !== identity.sessionId ||
      artifact.requestId !== identity.requestId ||
      artifact.revisionId !== identity.revisionId ||
      artifact.revisionVersion !== identity.revisionVersion ||
      artifact.artifactId !== identity.artifactId ||
      liveArtifacts.has(artifact.artifactId) ||
      backgroundCandidates.has(artifact.artifactId)
    ) {
      await releaseBackgroundArtifact(artifact);
      if (validArtifactIdentity(identity) && identity.artifactId !== artifact.artifactId) {
        await releaseCandidateIdentity(identity);
      }
      throw new RitoReaderErrorV1('invalid-wire', 'Background candidate identity is invalid');
    }
  }

  function requireVisibleArtifact(artifactId) {
    if (visibleArtifactId !== artifactId || !liveArtifacts.has(artifactId)) {
      throw new RitoReaderErrorV1(
        'stale-request',
        'Background guard is not the current visible artifact',
      );
    }
  }

  function requireForegroundCandidate(expectedVisibleArtifactId, candidateArtifactId, expected) {
    if (
      foregroundCandidate === undefined ||
      (expected !== undefined && foregroundCandidate !== expected) ||
      foregroundCandidate.artifactId !== candidateArtifactId ||
      visibleArtifactId !== expectedVisibleArtifactId ||
      !liveArtifacts.has(candidateArtifactId)
    ) {
      throw new RitoReaderErrorV1(
        'stale-request',
        'Foreground candidate is not pending for the visible intent',
      );
    }
    return foregroundCandidate;
  }

  function requireBackgroundIdle() {
    if (backgroundActive || foregroundOperations > 0 || foregroundCandidate !== undefined) {
      throw new RitoReaderErrorV1(
        'request-busy',
        'Reader v1 foreground work, candidates, and background operations share one session lane',
      );
    }
  }

  function beginBackgroundOperation() {
    backgroundActive = true;
    backgroundIdle = new Promise((resolve) => {
      finishBackground = resolve;
    });
  }

  function endBackgroundOperation() {
    backgroundActive = false;
    finishBackground?.();
    finishBackground = undefined;
    backgroundIdle = Promise.resolve();
  }

  function requireUsable() {
    if (terminalError) throw terminalError;
    if (phase === 'disposed') throw new RitoReaderErrorV1('session-disposed', 'Reader is disposed');
  }

  function requireOpen() {
    requireUsable();
    if (phase !== 'open') throw new RitoReaderErrorV1('invalid-session', `Reader is ${phase}`);
  }

  function nextRequestId() {
    requestId += 1n;
    return requestId;
  }

  function rejectPending(error) {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  }

  function detach() {
    worker.removeEventListener('message', handleMessage);
    worker.removeEventListener('error', handleError);
    worker.removeEventListener('messageerror', handleMessageError);
  }

  return {
    sessionId,
    open,
    readPublication,
    requestAdjacent,
    requestArtifact,
    seek,
    adoptForegroundCandidate,
    advanceBackgroundOnce,
    adoptBackgroundCandidate,
    readResource,
    release,
    dispose,
  };
}

function validArtifactIdentity(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.sessionId === 'bigint' &&
    typeof value.requestId === 'bigint' &&
    typeof value.revisionId === 'bigint' &&
    Number.isInteger(value.revisionVersion) &&
    typeof value.artifactId === 'bigint'
  );
}

function requireExactContinuationLimit(value) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_EXACT_CONTINUATION_QUANTA) {
    throw new RangeError(
      `maxExactContinuationQuanta must be within 1..${String(MAX_EXACT_CONTINUATION_QUANTA)}`,
    );
  }
  return value;
}

function requireAdjacentContinuationLimit(value) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_ADJACENT_CONTINUATION_QUANTA) {
    throw new RangeError(
      `maxAdjacentContinuationQuanta must be within 1..${String(MAX_ADJACENT_CONTINUATION_QUANTA)}`,
    );
  }
  return value;
}

function exactContinuationLimitError(limit) {
  return new RitoReaderErrorV1(
    'target-not-published',
    `Exact seek did not become ready within ${String(limit)} continuation quanta`,
  );
}

function adjacentContinuationLimitError(limit) {
  return new RitoReaderErrorV1(
    'target-not-published',
    `Adjacent target did not become ready within ${String(limit)} continuation quanta`,
  );
}

function isFatalSessionError(error) {
  return (
    !(error instanceof RitoReaderErrorV1) ||
    error.code === 'invalid-wire' ||
    error.code === 'engine-failure'
  );
}

function foregroundCandidateIdentity(artifact, requestTemplate) {
  return { artifactId: artifact.artifactId, requestId: artifact.requestId, requestTemplate };
}

function isPendingExactPayload(payload, request) {
  if (payload?.kind !== 'pending-exact') return false;
  if (payload.sessionId !== request.sessionId || payload.requestId !== request.requestId) {
    throw new RitoReaderErrorV1(
      'invalid-wire',
      'Pending exact-seek identity does not match its request',
    );
  }
  return true;
}

function isPendingAdjacentPayload(payload, request) {
  if (payload?.kind !== 'pending-adjacent') return false;
  if (
    payload.sessionId !== request.sessionId ||
    payload.requestId !== request.requestId ||
    payload.fromArtifactId !== request.fromArtifactId ||
    payload.direction !== request.direction
  ) {
    throw new RitoReaderErrorV1(
      'invalid-wire',
      'Pending adjacent identity does not match its request',
    );
  }
  return true;
}

function sessionDisposedError() {
  return new RitoReaderErrorV1('session-disposed', 'Reader v1 session was disposed');
}

function withRequestIdentity(request, sessionId, requestId) {
  return { ...request, sessionId, requestId };
}

function allocateSessionId() {
  const value = nextSessionId;
  nextSessionId += 1n;
  if (nextSessionId > 0x7fff_ffff_ffff_ffffn) nextSessionId = 1n;
  return value;
}

function isResponse(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.protocol === PROTOCOL &&
    Number.isSafeInteger(value.id) &&
    typeof value.ok === 'boolean'
  );
}

function responseError(value) {
  const error = value !== null && typeof value === 'object' ? value : {};
  return new RitoReaderErrorV1(
    ERROR_CODES.has(error.code) ? error.code : 'engine-failure',
    typeof error.message === 'string' ? error.message : 'Reader v1 worker failed',
  );
}

function invalidPayload(operation) {
  return new RitoReaderErrorV1(
    'invalid-wire',
    `Reader v1 returned an invalid ${operation} payload`,
  );
}

function staleRequestError() {
  return new RitoReaderErrorV1('stale-request', 'Reader v1 request was replaced by a newer seek');
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

function terminate(worker) {
  try {
    worker.terminate();
  } catch {
    // No live caller can recover a dedicated Reader v1 worker after termination.
  }
}
