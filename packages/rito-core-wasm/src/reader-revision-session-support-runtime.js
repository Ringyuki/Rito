import {
  requireSourceLocatorRequest,
  requireSourceLocatorResolution,
} from './reader-worker-interaction-validation-runtime.js';

export function requireReaderRevisionStartRequest(request) {
  if (request === null || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('revision reader start request must be an object');
  }
  const target = readerRevisionStartTarget(request);
  return {
    layoutConfig: request.layoutConfig,
    ...target,
  };
}

function readerRevisionStartTarget(request) {
  const hasLocator = request.targetLocator !== undefined;
  const hasSpread = request.targetSpreadIndex !== undefined;
  if (hasLocator && hasSpread) {
    throw new TypeError(
      'revision reader start targetLocator and targetSpreadIndex are mutually exclusive',
    );
  }
  if (hasLocator) {
    return {
      targetLocator: requireSourceLocatorRequest(
        request.targetLocator,
        'revision reader start target',
      ),
    };
  }
  return { targetSpreadIndex: requireSpreadIndex(request.targetSpreadIndex ?? 0) };
}

export function requireSpreadIndex(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('spread index must be a non-negative safe integer');
  }
  return value;
}

export function spreadTarget(spreadIndex, token) {
  return { kind: 'spread', spreadIndex, token };
}

export function locatorTarget(locator, token) {
  return {
    kind: 'locator',
    locator: requireSourceLocatorRequest(locator, 'revision reader ensureLocator'),
    token,
  };
}

export function sameTargetEvaluation(evaluation, target, handle) {
  return (
    evaluation !== undefined &&
    evaluation.token === target.token &&
    sameHandle(evaluation.handle, handle)
  );
}

export async function evaluateReaderRevisionTarget(
  client,
  target,
  revision,
  presentationSpreadIndex,
) {
  const handle = revisionHandle(revision);
  // The revision holds its whole page table, so a spread target and the
  // whole-table target are decided the moment the revision exists.
  if (target.kind === 'spread') {
    return {
      token: target.token,
      handle,
      available: true,
      spreadIndex: target.spreadIndex,
      snapshotTarget: { kind: 'spread', spreadIndex: target.spreadIndex },
    };
  }
  if (target.kind === 'complete') {
    return {
      token: target.token,
      handle,
      available: true,
      spreadIndex: presentationSpreadIndex,
      snapshotTarget: { kind: 'complete' },
    };
  }
  const resolved = await client.resolveSourceLocatorAtRevision(handle, target.locator);
  requireSameHandle(resolved.revision, handle, 'source locator resolution');
  const resolution = requireSourceLocatorResolution(
    resolved.value,
    handle,
    'source locator resolution',
  );
  return evaluateReaderRevisionLocatorResolution(
    target,
    revision,
    presentationSpreadIndex,
    resolution,
  );
}

export function evaluateReaderRevisionLocatorResolution(
  target,
  revision,
  presentationSpreadIndex,
  value,
) {
  const handle = revisionHandle(revision);
  const resolution = requireSourceLocatorResolution(value, handle, 'source locator resolution');
  if (resolution.status === 'resolved') {
    requireResolvedLocatorExtent(resolution, revision);
  } else if (resolution.reason === 'notPaginated') {
    throw new Error('a revision left a source locator unpaginated');
  }
  return {
    token: target.token,
    handle,
    available: resolution.status === 'resolved' || resolution.reason === 'noPageProjection',
    spreadIndex:
      resolution.status === 'resolved' ? resolution.spreadIndex : presentationSpreadIndex,
    snapshotTarget: {
      kind: 'locator',
      locator: resolution.locator,
      resolution,
    },
  };
}

export function requireAcceptedHandle(envelope, operation) {
  if (envelope?.revision === undefined || envelope?.value === undefined) {
    throw new Error(`${operation} returned no versioned value`);
  }
  if (envelope.revision.revisionVersion !== 0) {
    throw new Error(`${operation} did not start at revision version zero`);
  }
}

export function requireSameHandle(actual, expected, operation) {
  if (!sameHandle(actual, expected)) {
    throw new Error(`${operation} returned a mismatched revision handle`);
  }
}

export function requireSameRevisionSummary(actual, expected, operation) {
  if (
    actual.layoutKey !== expected.layoutKey ||
    actual.pageCount !== expected.pageCount ||
    actual.spreadCount !== expected.spreadCount
  ) {
    throw new Error(`${operation} returned a summary inconsistent with its accepted revision`);
  }
}

export function sameHandle(left, right) {
  return left?.revisionId === right?.revisionId && left?.revisionVersion === right?.revisionVersion;
}

export function revisionHandle(revision) {
  return { revisionId: revision.revisionId, revisionVersion: revision.revisionVersion };
}

export function isRecoverableTargetReadError(error) {
  return error?.code === 'engine-error';
}

export function defaultYieldControl() {
  const scheduler = globalThis.scheduler;
  if (typeof scheduler?.yield === 'function') {
    return scheduler.yield();
  }
  if (typeof globalThis.MessageChannel === 'function') {
    return new Promise((resolve) => {
      const channel = new globalThis.MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        channel.port2.close();
        resolve();
      };
      channel.port2.postMessage(undefined);
    });
  }
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

function requireResolvedLocatorExtent(resolution, revision) {
  if (
    resolution.pageIndex >= revision.pageCount ||
    resolution.spreadIndex >= revision.spreadCount
  ) {
    throw new Error('source locator resolution returned geometry outside the revision extent');
  }
}
