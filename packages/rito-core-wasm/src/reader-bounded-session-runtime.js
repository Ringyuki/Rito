export function createRitoCoreWasmBoundedReaderSession(client, options = {}) {
  const yieldControl = options.yieldControl ?? defaultYieldControl;
  let phase = 'idle';
  let generation = 0;
  let requestedSpreadIndex = 0;
  let startRequest;
  let revision;
  let continuation;
  let snapshot;
  let releasedTransferRevision;
  let drainPromise;
  let stopRequested;
  let terminalError;

  const start = (request) => {
    if (phase !== 'idle') throw new Error(`bounded reader session cannot start while ${phase}`);
    startRequest = requireStartRequest(request);
    requestedSpreadIndex = requireSpreadIndex(request.targetSpreadIndex ?? 0);
    phase = 'running';
    return waitForSnapshot();
  };

  const ensureSpread = (spreadIndex) => {
    if (phase !== 'running') {
      throw new Error(`bounded reader session cannot ensure a spread while ${phase}`);
    }
    requestedSpreadIndex = requireSpreadIndex(spreadIndex);
    return waitForSnapshot();
  };

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
      if (snapshotMatchesRequest()) return snapshot;
    }
    if (terminalError !== undefined) throw terminalError;
    throw new Error('bounded reader session stopped before the requested spread was available');
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
        acceptAdvance(await client.createBoundedRevision(startRequest), undefined);
      }
      while (phase === 'running') {
        if (stopRequested !== undefined) return cleanupLatest();
        if (snapshot === undefined || snapshot.requestedSpreadIndex !== requestedSpreadIndex) {
          await refreshSnapshot();
          continue;
        }
        if (requestedTargetAvailable()) return;
        await yieldControl();
        if (stopRequested !== undefined) return cleanupLatest();
        const previous = revision;
        await releaseRevisionTransfers(previous);
        if (stopRequested !== undefined) return cleanupLatest();
        if (snapshot?.requestedSpreadIndex !== requestedSpreadIndex && requestedTargetAvailable()) {
          continue;
        }
        acceptAdvance(
          await client.continueRevision({
            ...continuation,
            budget: startRequest.budget,
          }),
          previous,
        );
      }
    } catch (error) {
      await handlePumpFailure(error);
    }
  }

  async function refreshSnapshot() {
    const handle = revisionHandle(revision);
    const navigation = await client.getRevisionNavigationAtRevision(handle);
    requireSameHandle(navigation.revision, handle, 'revision navigation');
    if (navigation.value?.revisionId !== handle.revisionId) {
      throw new Error('revision navigation returned a mismatched revisionId');
    }
    if (
      navigation.value.pageCount !== revision.knownExtent.pageCount ||
      navigation.value.spreadCount !== revision.knownExtent.spreadCount
    ) {
      throw new Error('revision navigation returned an extent inconsistent with its revision');
    }
    if (stopRequested !== undefined) return;
    const target = requestedSpreadIndex;
    let frameWindow;
    if (requestedTargetAvailable() && revision.knownExtent.spreadCount > target) {
      const frame = await client.warmFrameWindowAtRevision(handle, target);
      requireSameHandle(frame.revision, handle, 'frame window');
      frameWindow = frame.value;
    }
    snapshot = {
      generation,
      revision,
      navigation: navigation.value,
      requestedSpreadIndex: target,
      ...(frameWindow !== undefined ? { frameWindow } : {}),
    };
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
    continuation = undefined;
    snapshot = undefined;
    phase = stopRequested === 'dispose' ? 'disposed' : 'stopped';
  }

  async function releaseRevisionTransfers(value) {
    const handle = revisionHandle(value);
    if (sameHandle(releasedTransferRevision, handle)) return;
    const released = await client.releaseRevisionTransfersAtRevision(handle);
    requireSameHandle(released.revision, handle, 'revision transfer release');
    releasedTransferRevision = handle;
  }

  function requestedTargetAvailable() {
    return (
      revision.status === 'complete' || revision.knownExtent.spreadCount > requestedSpreadIndex
    );
  }

  function snapshotMatchesRequest() {
    return (
      snapshot !== undefined &&
      snapshot.requestedSpreadIndex === requestedSpreadIndex &&
      requestedTargetAvailable() &&
      (snapshot.revision.knownExtent.spreadCount <= requestedSpreadIndex ||
        snapshot.frameWindow !== undefined)
    );
  }

  return { start, ensureSpread, currentSnapshot, cancel, dispose };
}

function requireStartRequest(request) {
  if (request === null || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('bounded reader start request must be an object');
  }
  return {
    layoutConfig: request.layoutConfig,
    ...(request.lineBreaking !== undefined ? { lineBreaking: request.lineBreaking } : {}),
    budget: { maxTopLevelNodes: request.budget?.maxTopLevelNodes },
  };
}

function requireSpreadIndex(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('spread index must be a non-negative safe integer');
  }
  return value;
}

function requireAcceptedHandle(envelope, previous, operation) {
  if (envelope?.revision === undefined || envelope?.value === undefined) {
    throw new Error(`${operation} returned no versioned value`);
  }
  if (previous === undefined) {
    if (envelope.revision.revisionVersion !== 0) {
      throw new Error(`${operation} did not start at revision version zero`);
    }
    return;
  }
  const expected = {
    revisionId: previous.revisionId,
    revisionVersion: previous.revisionVersion + 1,
  };
  requireSameHandle(envelope.revision, expected, operation);
}

function requireSameHandle(actual, expected, operation) {
  if (!sameHandle(actual, expected)) {
    throw new Error(`${operation} returned a mismatched revision handle`);
  }
}

function sameHandle(left, right) {
  return left?.revisionId === right?.revisionId && left?.revisionVersion === right?.revisionVersion;
}

function revisionHandle(revision) {
  return { revisionId: revision.revisionId, revisionVersion: revision.revisionVersion };
}

function isActiveRevision(revision) {
  return revision?.status === 'warming' || revision?.status === 'ready';
}

function isNextFailedRevision(candidate, previous) {
  return (
    candidate?.status === 'failed' &&
    previous !== undefined &&
    candidate.revisionId === previous.revisionId &&
    candidate.revisionVersion === previous.revisionVersion + 1
  );
}

function defaultYieldControl() {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}
