import { requireRevisionPresentation } from './revision-presentation-validation-runtime.js';
import {
  defaultYieldControl,
  evaluateBoundedReaderTarget,
  isActiveRevision,
  isNextFailedRevision,
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
  const yieldControl = options.yieldControl ?? defaultYieldControl;
  let phase = 'idle';
  let generation = 0;
  let targetSequence = 0;
  let requestedTarget;
  let presentationSpreadIndex = 0;
  let hasPublishedSnapshot = false;
  let targetEvaluation;
  let targetFailure;
  let snapshotTargetToken;
  let startRequest;
  let revision;
  let revisionPresentation;
  let continuation;
  let snapshot;
  let releasedTransferRevision;
  let drainPromise;
  let stopRequested;
  let terminalError;

  const start = (request) => {
    if (phase !== 'idle') throw new Error(`bounded reader session cannot start while ${phase}`);
    startRequest = requireBoundedReaderStartRequest(request);
    presentationSpreadIndex = requireSpreadIndex(request.targetSpreadIndex ?? 0);
    requestedTarget = spreadTarget(presentationSpreadIndex, ++targetSequence);
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
    if (phase === 'disposed') return;
    if (phase === 'idle' || phase === 'stopped') {
      phase = 'disposed';
      snapshot = undefined;
      return;
    }
    requestStop('dispose');
    while (phase === 'running') await drain();
  };

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
        acceptAdvance(await client.createBoundedRevision(initialRevisionRequest()), undefined);
      }
      while (phase === 'running') {
        if (stopRequested !== undefined) return cleanupLatest();
        const evaluation = await evaluateRequestedTarget();
        if (evaluation === undefined) {
          if (targetFailure?.token === requestedTarget?.token) return;
          continue;
        }
        if (stopRequested !== undefined) return cleanupLatest();
        if (evaluation.available && !snapshotMatchesEvaluation(evaluation)) {
          await refreshSnapshot(evaluation);
          if (targetFailure?.token === requestedTarget?.token) return;
          continue;
        }
        if (evaluation.available) return;
        await yieldControl();
        if (stopRequested !== undefined) return cleanupLatest();
        const previous = revision;
        await releaseRevisionTransfers(previous);
        if (stopRequested !== undefined) return cleanupLatest();
        const latestEvaluation = await evaluateRequestedTarget();
        if (latestEvaluation === undefined || latestEvaluation.available) continue;
        acceptAdvance(
          await client.continueRevision({
            ...continuation,
            budget: hasPublishedSnapshot ? startRequest.growthBudget : startRequest.budget,
          }),
          previous,
        );
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
      presentation.navigation.pageCount !== revision.knownExtent.pageCount ||
      presentation.navigation.spreadCount !== revision.knownExtent.spreadCount
    ) {
      throw new Error('revision presentation returned an extent inconsistent with its revision');
    }
    if (stopRequested !== undefined || !isCurrentEvaluation(evaluation)) return;
    const target = evaluation.spreadIndex;
    let frameWindow;
    if (revision.knownExtent.spreadCount > target) {
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
    hasPublishedSnapshot = true;
    presentationSpreadIndex = target;
    snapshotTargetToken = evaluation.token;
  }

  function initialRevisionRequest() {
    return {
      layoutConfig: startRequest.layoutConfig,
      ...(startRequest.lineBreaking !== undefined
        ? { lineBreaking: startRequest.lineBreaking }
        : {}),
      budget: startRequest.budget,
    };
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

  function acceptAdvance(envelope, previous) {
    requireAcceptedHandle(envelope, previous, 'revision advance');
    requireSameHandle(envelope.value.revision, envelope.revision, 'revision advance summary');
    revision = envelope.value.revision;
    continuation = envelope.value.continuation;
    acceptRevision();
  }

  function acceptSummary(envelope, previous, status) {
    requireAcceptedHandle(envelope, previous, 'revision summary');
    requireSameHandle(envelope.value, envelope.revision, 'revision summary value');
    if (envelope.value.status !== status) {
      throw new Error(`revision summary did not enter ${status}`);
    }
    revision = envelope.value;
    continuation = undefined;
    acceptRevision();
  }

  function acceptRevision() {
    generation += 1;
    snapshot = undefined;
    snapshotTargetToken = undefined;
    targetEvaluation = undefined;
    targetFailure = undefined;
    revisionPresentation = undefined;
    releasedTransferRevision = undefined;
    options.onAcceptedRevision?.({ generation, revision });
  }

  async function handlePumpFailure(error) {
    terminalError = error;
    if (error?.code === 'engine-error' && isNextFailedRevision(error.revision, revision)) {
      revision = error.revision;
      continuation = undefined;
      try {
        acceptRevision();
      } catch {
        // Preserve the engine failure while still releasing its exact failed revision.
      }
    }
    await cleanupLatest();
  }

  async function cleanupLatest() {
    try {
      if (isActiveRevision(revision)) {
        const previous = revision;
        await releaseRevisionTransfers(previous);
        acceptSummary(await client.cancelRevision(revisionHandle(previous)), previous, 'cancelled');
      }
    } catch (error) {
      terminalError ??= error;
    }
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
    continuation = undefined;
    snapshot = undefined;
    snapshotTargetToken = undefined;
    phase = stopRequested === 'dispose' ? 'disposed' : 'stopped';
  }

  async function releaseRevisionTransfers(value) {
    const handle = revisionHandle(value);
    if (sameHandle(releasedTransferRevision, handle)) return;
    const released = await client.releaseRevisionTransfersAtRevision(handle);
    requireSameHandle(released.revision, handle, 'revision transfer release');
    releasedTransferRevision = handle;
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
      (snapshot.revision.knownExtent.spreadCount <= evaluation.spreadIndex ||
        snapshot.frameWindow !== undefined)
    );
  }

  function snapshotMatchesRequest() {
    return snapshot !== undefined && snapshotTargetToken === requestedTarget?.token;
  }

  return { start, ensureSpread, ensureLocator, complete, currentSnapshot, cancel, dispose };
}
