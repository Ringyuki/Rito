import {
  requireInitialRevisionAdvance,
  requireMatchingRevisionSummary,
  requireRevisionAdvance,
  requireRevisionHandle,
  requireRevisionWorkBudget,
} from './core-wasm-versioned-validation-runtime.js';
import {
  requireFootnote,
  requireFootnoteKey,
  requireLocatorRequest,
  requirePageIndex,
  requirePageTargets,
  requireResolvedLocator,
} from './reader-worker-interaction-validation-runtime.js';

export function createVersionedReaderClientMethods(send) {
  return {
    createBoundedRevision: (request) => {
      const maximum = requireRevisionWorkBudget(request?.budget, 'createBoundedRevision');
      return versionedResult(
        send,
        'createBoundedRevision',
        { kind: 'createBoundedRevision', request },
        { revisionVersion: 0 },
        (result, revision) =>
          requireInitialRevisionAdvance(
            result,
            revision,
            'createBoundedRevision response',
            maximum,
          ),
        true,
      );
    },
    continueRevision: (request) => {
      const current = requireRevisionHandle(request, 'continueRevision');
      const maximum = requireRevisionWorkBudget(request?.budget, 'continueRevision');
      return versionedResult(
        send,
        'continueRevision',
        {
          kind: 'continueRevision',
          revision: current,
          cursor: request.cursor,
          budget: request.budget,
        },
        nextRevision(current, 'continueRevision'),
        (result, revision) =>
          requireRevisionAdvance(result, revision, 'continueRevision response', maximum),
        true,
      );
    },
    cancelRevision: (request) => {
      const current = requireRevisionHandle(request, 'cancelRevision');
      return versionedResult(
        send,
        'cancelRevision',
        { kind: 'cancelRevision', revision: current },
        nextRevision(current, 'cancelRevision'),
        (result, revision) =>
          requireMatchingRevisionSummary(result, revision, 'cancelRevision response', 'cancelled'),
        true,
      );
    },
    getRevisionSummaryAtRevision: (revision) =>
      currentRevisionResult(
        send,
        'getRevisionSummaryAtRevision',
        revision,
        {},
        requireMatchingRevisionSummary,
      ),
    getRevisionNavigationAtRevision: (revision) =>
      currentRevisionResult(send, 'getRevisionNavigationAtRevision', revision),
    readFrameBufferAtRevision: (revision, spreadIndex) =>
      currentRevisionResult(send, 'readFrameBufferAtRevision', revision, { spreadIndex }),
    warmFrameWindowAtRevision: (revision, spreadIndex) =>
      currentRevisionResult(send, 'warmFrameWindowAtRevision', revision, { spreadIndex }),
    getPageTargetsAtRevision: (revision, pageIndex) => {
      const expectedPageIndex = requirePageIndex(pageIndex, 'getPageTargetsAtRevision');
      return currentRevisionResult(
        send,
        'getPageTargetsAtRevision',
        revision,
        { pageIndex: expectedPageIndex },
        (result, handle, operation) =>
          requirePageTargets(result, handle, expectedPageIndex, operation),
      );
    },
    getFootnoteAtRevision: (revision, key) => {
      const expectedKey = requireFootnoteKey(key, 'getFootnoteAtRevision');
      return currentRevisionResult(
        send,
        'getFootnoteAtRevision',
        revision,
        { key: expectedKey },
        (result, handle, operation) => requireFootnote(result, handle, expectedKey, operation),
      );
    },
    resolveLocatorAtRevision: (revision, locator) => {
      const expectedLocator = requireLocatorRequest(locator, 'resolveLocatorAtRevision');
      return currentRevisionResult(
        send,
        'resolveLocatorAtRevision',
        revision,
        { locator: expectedLocator },
        (result, handle, operation) =>
          requireResolvedLocator(result, handle, expectedLocator, operation),
      );
    },
    readResourceAtRevision: (revision, resourceKind, href) =>
      currentRevisionResult(send, 'readResourceAtRevision', revision, { resourceKind, href }),
    resolveSourceLocatorAtRevision: (revision, locator) =>
      currentRevisionResult(send, 'resolveSourceLocatorAtRevision', revision, { locator }),
    releaseRevisionTransfersAtRevision: (revision) =>
      currentRevisionResult(send, 'releaseRevisionTransfersAtRevision', revision),
    releaseRevisionAtRevision: (revision) =>
      currentRevisionResult(send, 'releaseRevisionAtRevision', revision),
  };
}

function currentRevisionResult(send, kind, revision, fields = {}, validateResult) {
  const current = requireRevisionHandle(revision, kind);
  return versionedResult(
    send,
    kind,
    { kind, revision: current, ...fields },
    current,
    validateResult,
  );
}

async function versionedResult(
  send,
  kind,
  request,
  expected,
  validateResult,
  rollbackInvalidResult = false,
) {
  const payload = await send(request);
  if (payload?.kind !== kind) {
    throw new Error(`Rito reader worker returned ${String(payload?.kind)} for ${kind}`);
  }
  const revision = requireRevisionHandle(payload.revision, `${kind} response`);
  if (
    (expected.revisionId !== undefined && revision.revisionId !== expected.revisionId) ||
    revision.revisionVersion !== expected.revisionVersion
  ) {
    throw new Error(`Rito reader worker returned a mismatched revision handle for ${kind}`);
  }
  try {
    if (!Object.hasOwn(payload, 'result')) {
      throw new Error(`Rito reader worker returned no result for ${kind}`);
    }
    const value = validateResult?.(payload.result, revision, `${kind} response`) ?? payload.result;
    return { revision, value };
  } catch (error) {
    if (rollbackInvalidResult) await rollbackCommittedRevision(send, revision);
    throw error;
  }
}

async function rollbackCommittedRevision(send, revision) {
  try {
    const payload = await send({ kind: 'releaseRevisionAtRevision', revision });
    if (payload?.kind !== 'releaseRevisionAtRevision') {
      throw new Error('Rito reader worker returned an unrelated rollback response');
    }
    const released = requireRevisionHandle(payload.revision, 'committed revision rollback');
    if (
      released.revisionId !== revision.revisionId ||
      released.revisionVersion !== revision.revisionVersion
    ) {
      throw new Error('Rito reader worker returned a mismatched rollback handle');
    }
  } catch {
    // Preserve the malformed mutation response; exact rollback is best effort.
  }
}

function nextRevision(revision, operation) {
  if (revision.revisionVersion === 0xffff_ffff) {
    throw new Error(`${operation} cannot advance revisionVersion beyond u32`);
  }
  return {
    revisionId: revision.revisionId,
    revisionVersion: revision.revisionVersion + 1,
  };
}
