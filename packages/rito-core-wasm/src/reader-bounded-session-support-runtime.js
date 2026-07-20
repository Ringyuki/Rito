import {
  requireSourceLocatorRequest,
  requireSourceLocatorResolution,
} from './reader-worker-interaction-validation-runtime.js';
import { requireRevisionWorkBudget } from './core-wasm-versioned-validation-runtime.js';

export function requireBoundedReaderStartRequest(request) {
  if (request === null || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('bounded reader start request must be an object');
  }
  const budget = boundedReaderBudget(request.budget, 'bounded reader start');
  const target = boundedReaderStartTarget(request);
  return {
    layoutConfig: request.layoutConfig,
    ...(request.lineBreaking !== undefined ? { lineBreaking: request.lineBreaking } : {}),
    budget,
    growthBudget:
      request.growthBudget === undefined
        ? budget
        : boundedReaderBudget(request.growthBudget, 'bounded reader growth'),
    ...target,
  };
}

function boundedReaderStartTarget(request) {
  const hasLocator = request.targetLocator !== undefined;
  const hasSpread = request.targetSpreadIndex !== undefined;
  if (hasLocator && hasSpread) {
    throw new TypeError(
      'bounded reader start targetLocator and targetSpreadIndex are mutually exclusive',
    );
  }
  if (hasLocator) {
    return {
      targetLocator: requireSourceLocatorRequest(
        request.targetLocator,
        'bounded reader start target',
      ),
    };
  }
  return { targetSpreadIndex: requireSpreadIndex(request.targetSpreadIndex ?? 0) };
}

function boundedReaderBudget(value, operation) {
  return { maxTopLevelNodes: requireRevisionWorkBudget(value, operation) };
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
    locator: requireSourceLocatorRequest(locator, 'bounded reader ensureLocator'),
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

export async function evaluateBoundedReaderTarget(
  client,
  target,
  revision,
  presentationSpreadIndex,
) {
  const handle = revisionHandle(revision);
  if (target.kind === 'spread') {
    return {
      token: target.token,
      handle,
      available:
        revision.status === 'complete' || revision.knownExtent.spreadCount > target.spreadIndex,
      spreadIndex: target.spreadIndex,
      snapshotTarget: { kind: 'spread', spreadIndex: target.spreadIndex },
    };
  }
  if (target.kind === 'complete') {
    return {
      token: target.token,
      handle,
      available: revision.status === 'complete',
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
  return evaluateBoundedReaderLocatorResolution(
    target,
    revision,
    presentationSpreadIndex,
    resolution,
  );
}

export function evaluateBoundedReaderLocatorResolution(
  target,
  revision,
  presentationSpreadIndex,
  value,
) {
  const handle = revisionHandle(revision);
  const resolution = requireSourceLocatorResolution(value, handle, 'source locator resolution');
  if (resolution.status === 'resolved') {
    requireResolvedLocatorExtent(resolution, revision);
  } else if (revision.status === 'complete' && resolution.reason === 'notPaginated') {
    throw new Error('complete revision left a source locator unpaginated');
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

export function requireAcceptedHandle(envelope, previous, operation, advancedQuanta = 1) {
  if (envelope?.revision === undefined || envelope?.value === undefined) {
    throw new Error(`${operation} returned no versioned value`);
  }
  if (!Number.isSafeInteger(advancedQuanta) || advancedQuanta <= 0) {
    throw new Error(`${operation} returned an invalid advanced quantum count`);
  }
  if (previous === undefined) {
    if (envelope.revision.revisionVersion !== 0) {
      throw new Error(`${operation} did not start at revision version zero`);
    }
    return;
  }
  const revisionVersion = previous.revisionVersion + advancedQuanta;
  if (!Number.isSafeInteger(revisionVersion) || revisionVersion > 0xffff_ffff) {
    throw new Error(`${operation} advanced revision version beyond u32`);
  }
  requireSameHandle(
    envelope.revision,
    { revisionId: previous.revisionId, revisionVersion },
    operation,
  );
}

export function requireSameHandle(actual, expected, operation) {
  if (!sameHandle(actual, expected)) {
    throw new Error(`${operation} returned a mismatched revision handle`);
  }
}

export function requireSameRevisionSummary(actual, expected, operation) {
  if (
    actual.layoutKey !== expected.layoutKey ||
    actual.status !== expected.status ||
    !sameExtent(actual.knownExtent, expected.knownExtent) ||
    !sameExtent(actual.finalExtent, expected.finalExtent) ||
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

export function isActiveRevision(revision) {
  return revision?.status === 'warming' || revision?.status === 'ready';
}

export function isNextFailedRevision(candidate, previous, maximumStride = 1) {
  const stride = candidate?.revisionVersion - previous?.revisionVersion;
  return (
    candidate?.status === 'failed' &&
    previous !== undefined &&
    candidate.revisionId === previous.revisionId &&
    Number.isSafeInteger(maximumStride) &&
    maximumStride > 0 &&
    Number.isSafeInteger(stride) &&
    stride >= 1 &&
    stride <= maximumStride
  );
}

export function isRecoverableTargetReadError(error) {
  return error?.code === 'engine-error' && error?.revision === undefined;
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
    resolution.pageIndex >= revision.knownExtent.pageCount ||
    resolution.spreadIndex >= revision.knownExtent.spreadCount
  ) {
    throw new Error('source locator resolution returned geometry outside the known extent');
  }
}

function sameExtent(left, right) {
  if (left === undefined || right === undefined) return left === right;
  return left.pageCount === right.pageCount && left.spreadCount === right.spreadCount;
}
