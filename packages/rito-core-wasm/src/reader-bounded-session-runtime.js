import { requireRevisionPresentation } from './revision-presentation-validation-runtime.js';
import {
  evaluateBoundedReaderTarget,
  isRecoverableTargetReadError,
  locatorTarget,
  requireAcceptedHandle,
  requireBoundedReaderStartRequest,
  requireSameHandle,
  requireSameRevisionSummary,
  requireSpreadIndex,
  revisionHandle,
  sameHandle,
  sameTargetEvaluation,
  spreadTarget,
} from './reader-bounded-session-support-runtime.js';

export function createRitoCoreWasmBoundedReaderSession(client, options = {}) {
  let phase = 'idle';
  let generation = 0;
  let targetSequence = 0;
  let requestedTarget;
  let presentationSpreadIndex = 0;
  let targetEvaluation;
  let targetFailure;
  let snapshotTargetToken;
  let startRequest;
  let revision;
  let revisionPresentation;
  let snapshot;
  let drainPromise;
  let stopRequested;
  let terminalError;

  const start = (request) => {
    if (phase !== 'idle') throw new Error(`bounded reader session cannot start while ${phase}`);
    startRequest = requireBoundedReaderStartRequest(request);
    presentationSpreadIndex = startRequest.targetSpreadIndex ?? 0;
    requestedTarget = initialTarget(startRequest, ++targetSequence);
    phase = 'running';
    return waitForSnapshot();
  };

  const ensureSpread = (spreadIndex) => {
    if (phase !== 'running') {
      throw new Error(`bounded reader session cannot ensure a spread while ${phase}`);
    }
    requestedTarget = spreadTarget(requireSpreadIndex(spreadIndex), ++targetSequence);
    targetEvaluation = undefined;
    targetFailure = undefined;
    return waitForSnapshot();
  };

  const ensureLocator = (locator) => {
    requireRunning('ensure a locator');
    requestedTarget = locatorTarget(locator, ++targetSequence);
    targetEvaluation = undefined;
    targetFailure = undefined;
    return waitForSnapshot();
  };

  const complete = () => {
    requireRunning('complete');
    requestedTarget = { kind: 'complete', token: ++targetSequence };
    targetEvaluation = undefined;
    targetFailure = undefined;
    return waitForSnapshot();
  };

  function requireRunning(operation) {
    if (phase !== 'running') {
      throw new Error(`bounded reader session cannot ${operation} while ${phase}`);
    }
  }

  const currentSnapshot = () => snapshot;

  const cancel = async () => {
    if (phase === 'idle' || phase === 'disposed') return;
    if (phase === 'running') requestStop('cancel');
    while (phase === 'running') await drain();
    if (terminalError !== undefined) throw terminalError;
  };

  const dispose = async () => {
    if (phase === 'disposed') {
      throwTerminalError();
      return;
    }
    if (phase === 'idle' || phase === 'stopped') {
      phase = 'disposed';
      snapshot = undefined;
      throwTerminalError();
      return;
    }
    requestStop('dispose');
    while (phase === 'running') await drain();
    throwTerminalError();
  };

  function throwTerminalError() {
    if (terminalError !== undefined) throw terminalError;
  }

  function requestStop(reason) {
    if (reason === 'dispose' || stopRequested === undefined) stopRequested = reason;
  }

  async function waitForSnapshot() {
    while (phase === 'running') {
      await drain();
      if (terminalError !== undefined) throw terminalError;
      if (targetFailure?.token === requestedTarget?.token) throw targetFailure.error;
      if (snapshotMatchesRequest()) return snapshot;
    }
    if (terminalError !== undefined) throw terminalError;
    throw new Error('bounded reader session stopped before the requested target was available');
  }

  function drain() {
    drainPromise ??= runPump().finally(() => {
      drainPromise = undefined;
    });
    return drainPromise;
  }

  async function runPump() {
    try {
      if (revision === undefined) {
        acceptCreatedRevision(await client.createBoundedRevision(initialRevisionRequest()));
      }
      while (phase === 'running') {
        if (stopRequested !== undefined) return cleanupLatest();
        const evaluation = await evaluateRequestedTarget();
        if (evaluation === undefined) {
          if (targetFailure?.token === requestedTarget?.token) return;
          continue;
        }
        if (stopRequested !== undefined) return cleanupLatest();
        if (!evaluation.available) {
          // The revision paginated whole when it was created; a target
          // it cannot serve now can never be served by it.
          throw new Error('bounded reader target is unavailable on a complete revision');
        }
        if (!snapshotMatchesEvaluation(evaluation)) {
          await refreshSnapshot(evaluation);
          if (targetFailure?.token === requestedTarget?.token) return;
          continue;
        }
        return;
      }
    } catch (error) {
      await handlePumpFailure(error);
    }
  }

  async function evaluateRequestedTarget() {
    const target = requestedTarget;
    const handle = revisionHandle(revision);
    if (sameTargetEvaluation(targetEvaluation, target, handle)) return targetEvaluation;
    let evaluation;
    try {
      evaluation = await evaluateBoundedReaderTarget(
        client,
        target,
        revision,
        presentationSpreadIndex,
      );
    } catch (error) {
      if (!isCurrentTarget(target, handle)) return undefined;
      if (target.kind === 'locator' && isRecoverableTargetReadError(error)) {
        targetFailure = { token: target.token, error };
        return undefined;
      }
      throw error;
    }
    if (!isCurrentTarget(target, handle)) return undefined;
    targetEvaluation = evaluation;
    return targetEvaluation;
  }

  async function refreshSnapshot(evaluation) {
    const { handle } = evaluation;
    const presentation = revisionPresentation ?? (await readRevisionPresentation(handle));
    if (
      presentation.navigation.pageCount !== revision.pageCount ||
      presentation.navigation.spreadCount !== revision.spreadCount
    ) {
      throw new Error('revision presentation returned an extent inconsistent with its revision');
    }
    if (stopRequested !== undefined || !isCurrentEvaluation(evaluation)) return;
    const target = evaluation.spreadIndex;
    let frameWindow;
    if (revision.spreadCount > target) {
      let frame;
      try {
        frame = await client.warmFrameWindowAtRevision(handle, target);
      } catch (error) {
        if (!isCurrentEvaluation(evaluation)) return;
        if (isRecoverableTargetReadError(error)) {
          targetFailure = { token: evaluation.token, error };
          return;
        }
        throw error;
      }
      requireSameHandle(frame.revision, handle, 'frame window');
      frameWindow = frame.value;
    }
    if (stopRequested !== undefined || !isCurrentEvaluation(evaluation)) return;
    snapshot = {
      generation,
      revision,
      presentation,
      navigation: presentation.navigation,
      target: evaluation.snapshotTarget,
      presentationSpreadIndex: target,
      ...(frameWindow !== undefined ? { frameWindow } : {}),
    };
    presentationSpreadIndex = target;
    snapshotTargetToken = evaluation.token;
  }

  function initialRevisionRequest() {
    return { layoutConfig: startRequest.layoutConfig };
  }

  async function readRevisionPresentation(handle) {
    const presented = await client.getRevisionPresentationAtRevision(handle);
    requireSameHandle(presented.revision, handle, 'revision presentation');
    const presentation = requireRevisionPresentation(
      presented.value,
      handle,
      'revision presentation',
    );
    requireSameRevisionSummary(presentation.revision, revision, 'revision presentation');
    revisionPresentation = presentation;
    return presentation;
  }

  function acceptCreatedRevision(envelope) {
    requireAcceptedHandle(envelope, 'revision creation');
    requireSameHandle(envelope.value, envelope.revision, 'revision creation summary');
    revision = envelope.value;
    acceptRevision();
  }

  function acceptRevision() {
    generation += 1;
    snapshot = undefined;
    snapshotTargetToken = undefined;
    targetEvaluation = undefined;
    targetFailure = undefined;
    revisionPresentation = undefined;
    options.onAcceptedRevision?.({ generation, revision });
  }

  async function handlePumpFailure(error) {
    terminalError = error;
    await cleanupLatest();
  }

  // The revision is complete the moment it exists, so cleanup is one
  // exact release: no transfer release or cancel round trip precedes it.
  async function cleanupLatest() {
    if (revision !== undefined) {
      const handle = revisionHandle(revision);
      try {
        const released = await client.releaseRevisionAtRevision(handle);
        requireSameHandle(released.revision, handle, 'revision release');
        if (released.value?.releasedRevision !== true) {
          throw new Error('revision release did not release its exact revision');
        }
      } catch (error) {
        terminalError ??= error;
      }
    }
    revision = undefined;
    revisionPresentation = undefined;
    targetEvaluation = undefined;
    targetFailure = undefined;
    snapshot = undefined;
    snapshotTargetToken = undefined;
    phase = stopRequested === 'dispose' ? 'disposed' : 'stopped';
  }

  function isCurrentTarget(target, handle) {
    return (
      phase === 'running' &&
      requestedTarget === target &&
      stopRequested === undefined &&
      sameHandle(revision, handle)
    );
  }

  function isCurrentEvaluation(evaluation) {
    return (
      requestedTarget?.token === evaluation.token &&
      sameHandle(revision, evaluation.handle) &&
      targetEvaluation === evaluation
    );
  }

  function snapshotMatchesEvaluation(evaluation) {
    return (
      snapshot !== undefined &&
      snapshotTargetToken === evaluation.token &&
      evaluation.available &&
      (snapshot.revision.spreadCount <= evaluation.spreadIndex ||
        snapshot.frameWindow !== undefined)
    );
  }

  function snapshotMatchesRequest() {
    return snapshot !== undefined && snapshotTargetToken === requestedTarget?.token;
  }

  return {
    start,
    ensureSpread,
    ensureLocator,
    complete,
    currentSnapshot,
    cancel,
    dispose,
  };
}

function initialTarget(request, token) {
  return request.targetLocator === undefined
    ? spreadTarget(request.targetSpreadIndex, token)
    : locatorTarget(request.targetLocator, token);
}
