import {
  requireAdvancedRevisionHandle,
  requireContinuationBatchCount,
  requireContinuationBatchLimit,
  requireContinuationTargetSpreadIndex,
  requireInitialRevisionAdvance,
  requireMatchingRevisionSummary,
  requireMatchingHandle,
  requireRevisionAdvance,
  requireRevisionHandle,
  requireRevisionTransferCount,
  requireRevisionWorkBudget,
} from './core-wasm-versioned-validation-runtime.js';
import { requireRevisionPresentation } from './revision-presentation-validation-runtime.js';
import {
  requireTextCaretTransport,
  requireTextPointRequest,
} from './reader-worker-exact-text-interaction-validation-runtime.js';
import {
  requireTextRangeRequest,
  requireTextRangeTransport,
} from './reader-worker-exact-text-range-validation-runtime.js';
import {
  requireTextRangeFromPointsRequest,
  requireTextRangeFromPointsTransport,
  requireTextRangeToPointRequest,
  requireTextRangeToPointTransport,
} from './reader-worker-text-range-from-points-validation-runtime.js';
import {
  requireTextSelectionMovementRequest,
  requireTextSelectionMovementTransport,
} from './reader-worker-text-selection-movement-validation-runtime.js';
import {
  requireExactSourceRangeRequest,
  requireExactSourceRangeTransport,
} from './reader-worker-exact-source-range-validation-runtime.js';
import { createPageSemanticsClientMethod } from './reader-worker-page-semantics-runtime.js';
import { createPageReadingAnchorClientMethod } from './reader-worker-page-reading-anchor-runtime.js';
import {
  requireFootnote,
  requireFootnoteKey,
  requireLocatorRequest,
  requirePageIndex,
  requirePageTargets,
  requireResolvedLocator,
  requireSourceLocatorRequest,
  requireSourceLocatorTransport,
} from './reader-worker-interaction-validation-runtime.js';
import {
  requirePageTextPositions,
  requireTextRangeGeometryDiagnostic,
  requireTextRangeGeometryRequest,
} from './reader-worker-text-geometry-validation-runtime.js';
import { requireShapeProvenanceDiagnostic } from './shape-provenance-diagnostic-validation-runtime.js';
import {
  requireChapterTextIndices,
  requireFootnotes,
  requireReaderRevisionBundle,
  requireSearchRequest,
  requireSearchResponse,
} from './reader-worker-versioned-read-validation-runtime.js';
import { requireSourceLocatorContinuationResult } from './source-locator-continuation-validation-runtime.js';
import {
  requireFontVerticalMetricCalibrationRequest,
  requireFontVerticalMetricCalibrationTransferResult,
} from './font-vertical-metric-calibration-validation-runtime.js';

export function createVersionedReaderClientMethods(send, disposeInvalid) {
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
        disposeInvalid,
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
        disposeInvalid,
      );
    },
    continueRevisionAfterTransferRelease: (request) => {
      const operation = 'continueRevisionAfterTransferRelease';
      const current = requireRevisionHandle(request, operation);
      const maximum = requireRevisionWorkBudget(request?.budget, operation);
      const batchMaximum = continuationBatchMaximum(
        current,
        requireContinuationBatchLimit(request?.maxQuanta, operation),
        operation,
      );
      const targetSpreadIndex = requireContinuationTargetSpreadIndex(
        request?.targetSpreadIndex,
        operation,
      );
      return versionedResult(
        send,
        operation,
        {
          kind: operation,
          revision: current,
          cursor: request.cursor,
          budget: request.budget,
          maxQuanta: batchMaximum,
          ...(targetSpreadIndex !== undefined ? { targetSpreadIndex } : {}),
        },
        advancedRevisionRange(current, batchMaximum),
        (result, revision) => {
          if (result === null || typeof result !== 'object' || Array.isArray(result)) {
            throw new Error(`${operation} response returned an invalid result`);
          }
          const advancedQuanta = requireContinuationBatchCount(
            result.advancedQuanta,
            batchMaximum,
            operation,
          );
          requireAdvancedRevisionHandle(current, revision, advancedQuanta, operation);
          return {
            advance: requireRevisionAdvance(
              result.advance,
              revision,
              `${operation} response`,
              processedNodeMaximum(maximum, advancedQuanta),
            ),
            releasedRevision: requireMatchingHandle(
              result.releasedRevision,
              current,
              `${operation} response released revision`,
            ),
            releasedTransferCount: requireRevisionTransferCount(
              result.releasedTransferCount,
              `${operation} response`,
            ),
            advancedQuanta,
          };
        },
        true,
        disposeInvalid,
      );
    },
    continueRevisionTowardSourceLocator: (request) => {
      const operation = 'continueRevisionTowardSourceLocator';
      const current = requireRevisionHandle(request, operation);
      const maximum = requireRevisionWorkBudget(request?.budget, operation);
      const batchMaximum = continuationBatchMaximum(
        current,
        requireContinuationBatchLimit(request?.maxQuanta, operation),
        operation,
      );
      const locator = requireSourceLocatorRequest(request?.locator, operation);
      return versionedResult(
        send,
        operation,
        {
          kind: operation,
          revision: current,
          cursor: request.cursor,
          budget: request.budget,
          locator,
          maxQuanta: batchMaximum,
        },
        advancedRevisionRange(current, batchMaximum),
        (result, revision) =>
          requireSourceLocatorContinuationResult(
            result,
            current,
            revision,
            locator,
            `${operation} response`,
            maximum,
            batchMaximum,
          ),
        true,
        disposeInvalid,
      );
    },
    calibrateRevisionFontVerticalMetrics: (request) => {
      const operation = 'calibrateRevisionFontVerticalMetrics';
      const input = requireFontVerticalMetricCalibrationRequest(request, operation);
      const current = requireRevisionHandle(input, operation);
      return versionedResult(
        send,
        operation,
        {
          kind: operation,
          revision: current,
          ...(input.continuation === undefined ? {} : { continuation: input.continuation }),
          fontVerticalMetrics: input.fontVerticalMetrics,
        },
        nextRevision(current, operation),
        (result, revision) =>
          requireFontVerticalMetricCalibrationTransferResult(
            result,
            current,
            revision,
            `${operation} response`,
          ),
        true,
        disposeInvalid,
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
        disposeInvalid,
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
    getRevisionBundleAtRevision: (revision, includeTocTargets = false) =>
      currentRevisionResult(
        send,
        'getRevisionBundleAtRevision',
        revision,
        { includeTocTargets: includeTocTargets === true },
        requireReaderRevisionBundle,
      ),
    getRevisionPresentationAtRevision: (revision) =>
      currentRevisionResult(
        send,
        'getRevisionPresentationAtRevision',
        revision,
        {},
        requireRevisionPresentation,
      ),
    getShapeProvenanceDiagnosticAtRevision: (revision) =>
      currentRevisionResult(
        send,
        'getShapeProvenanceDiagnosticAtRevision',
        revision,
        {},
        requireShapeProvenanceDiagnostic,
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
    getPageSemanticsAtRevision: createPageSemanticsClientMethod(send, currentRevisionResult),
    getPageReadingAnchorAtRevision: createPageReadingAnchorClientMethod(
      send,
      currentRevisionResult,
    ),
    getPageTextPositionsAtRevision: (revision, pageIndex) => {
      const expectedPageIndex = requirePageIndex(pageIndex, 'getPageTextPositionsAtRevision');
      return currentRevisionResult(
        send,
        'getPageTextPositionsAtRevision',
        revision,
        { pageIndex: expectedPageIndex },
        (result, handle, operation) =>
          requirePageTextPositions(result, handle, expectedPageIndex, operation),
      );
    },
    getTextRangeGeometryAtRevision: (revision, request) => {
      const expectedRequest = requireTextRangeGeometryRequest(
        request,
        'getTextRangeGeometryAtRevision',
      );
      return currentRevisionResult(
        send,
        'getTextRangeGeometryAtRevision',
        revision,
        { request: expectedRequest },
        (result, handle, operation) =>
          requireTextRangeGeometryDiagnostic(result, handle, expectedRequest, operation),
      );
    },
    resolveTextCaretAtRevision: (revision, request) => {
      const expectedRequest = requireTextPointRequest(request, 'resolveTextCaretAtRevision');
      return currentRevisionResult(
        send,
        'resolveTextCaretAtRevision',
        revision,
        { request: expectedRequest },
        (result, handle, operation) =>
          requireTextCaretTransport(result, handle, expectedRequest, operation),
      );
    },
    resolveTextRangeAtRevision: (revision, request) => {
      const expectedRequest = requireTextRangeRequest(request, 'resolveTextRangeAtRevision');
      return currentRevisionResult(
        send,
        'resolveTextRangeAtRevision',
        revision,
        { request: expectedRequest },
        (result, handle, operation) =>
          requireTextRangeTransport(result, handle, expectedRequest, operation),
      );
    },
    resolveTextRangeFromPointsAtRevision: (revision, request) => {
      const expectedRequest = requireTextRangeFromPointsRequest(
        request,
        'resolveTextRangeFromPointsAtRevision',
      );
      return currentRevisionResult(
        send,
        'resolveTextRangeFromPointsAtRevision',
        revision,
        { request: expectedRequest },
        (result, handle, operation) =>
          requireTextRangeFromPointsTransport(result, handle, expectedRequest, operation),
      );
    },
    resolveTextRangeToPointAtRevision: (revision, request) => {
      const expectedRequest = requireTextRangeToPointRequest(
        request,
        'resolveTextRangeToPointAtRevision',
      );
      return currentRevisionResult(
        send,
        'resolveTextRangeToPointAtRevision',
        revision,
        { request: expectedRequest },
        (result, handle, operation) =>
          requireTextRangeToPointTransport(result, handle, expectedRequest, operation),
      );
    },
    resolveTextSelectionMovementAtRevision: (revision, request) => {
      const expectedRequest = requireTextSelectionMovementRequest(
        request,
        'resolveTextSelectionMovementAtRevision',
      );
      return currentRevisionResult(
        send,
        'resolveTextSelectionMovementAtRevision',
        revision,
        { request: expectedRequest },
        (result, handle, operation) =>
          requireTextSelectionMovementTransport(result, handle, expectedRequest, operation),
      );
    },
    resolveExactSourceRangeAtRevision: (revision, request) => {
      const expectedRequest = requireExactSourceRangeRequest(
        request,
        'resolveExactSourceRangeAtRevision',
      );
      return currentRevisionResult(
        send,
        'resolveExactSourceRangeAtRevision',
        revision,
        { request: expectedRequest },
        (result, handle, operation) =>
          requireExactSourceRangeTransport(result, handle, expectedRequest, operation),
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
    getFootnotesAtRevision: (revision) =>
      currentRevisionResult(send, 'getFootnotesAtRevision', revision, {}, requireFootnotes),
    getChapterTextIndicesAtRevision: (revision) =>
      currentRevisionResult(
        send,
        'getChapterTextIndicesAtRevision',
        revision,
        {},
        requireChapterTextIndices,
      ),
    searchAtRevision: (revision, request) => {
      const expectedRequest = requireSearchRequest(request, 'searchAtRevision');
      return currentRevisionResult(
        send,
        'searchAtRevision',
        revision,
        { request: expectedRequest },
        (result, handle, operation) =>
          requireSearchResponse(result, handle, expectedRequest, operation),
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
    resolveSourceLocatorAtRevision: (revision, locator) => {
      const expectedLocator = requireSourceLocatorRequest(
        locator,
        'resolveSourceLocatorAtRevision',
      );
      return currentRevisionResult(
        send,
        'resolveSourceLocatorAtRevision',
        revision,
        { locator: expectedLocator },
        (result, handle, operation) =>
          requireSourceLocatorTransport(result, handle, expectedLocator, operation),
      );
    },
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
  disposeInvalid,
) {
  const payload = await send(request);
  let revision;
  try {
    if (payload?.kind !== kind) {
      throw new Error(`Rito reader worker returned ${String(payload?.kind)} for ${kind}`);
    }
    const responseRevision = requireRevisionHandle(payload.revision, `${kind} response`);
    if (!matchesExpectedRevision(responseRevision, expected)) {
      throw new Error(`Rito reader worker returned a mismatched revision handle for ${kind}`);
    }
    revision = responseRevision;
    if (!Object.hasOwn(payload, 'result')) {
      throw new Error(`Rito reader worker returned no result for ${kind}`);
    }
    const value = validateResult?.(payload.result, revision, `${kind} response`) ?? payload.result;
    return { revision, value };
  } catch (error) {
    if (rollbackInvalidResult) {
      const rollback = mutationRollbackHandle(expected, revision);
      if (rollback === undefined) bestEffortDispose(disposeInvalid);
      else if (!(await rollbackCommittedRevision(send, rollback))) {
        bestEffortDispose(disposeInvalid);
      }
    }
    throw error;
  }
}

function mutationRollbackHandle(expected, validatedRevision) {
  if (validatedRevision !== undefined) return validatedRevision;
  if (expected.revisionId !== undefined) {
    if (expected.revisionVersion === undefined) return undefined;
    return {
      revisionId: expected.revisionId,
      revisionVersion: expected.revisionVersion,
    };
  }
  // A created revision has no caller-known id. Only a handle already bound to
  // the correct response kind/version can be released; otherwise dispose the owner.
  return undefined;
}

function bestEffortDispose(disposeInvalid) {
  try {
    disposeInvalid?.();
  } catch {
    // Preserve the malformed mutation response after best-effort containment.
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
    if (payload.result?.releasedRevision !== true) {
      throw new Error('Rito reader worker did not confirm exact revision rollback');
    }
    requireRevisionTransferCount(
      payload.result.releasedTransferCount,
      'committed revision rollback',
    );
    return true;
  } catch {
    // Preserve the malformed mutation response; exact rollback is best effort.
    return false;
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

function continuationBatchMaximum(revision, requested, operation) {
  if (revision.revisionVersion === 0xffff_ffff) {
    throw new Error(`${operation} cannot advance revisionVersion beyond u32`);
  }
  return Math.min(requested, 0xffff_ffff - revision.revisionVersion);
}

function advancedRevisionRange(revision, maximum) {
  return {
    revisionId: revision.revisionId,
    minimumRevisionVersion: revision.revisionVersion + 1,
    maximumRevisionVersion: revision.revisionVersion + maximum,
  };
}

function matchesExpectedRevision(revision, expected) {
  if (expected.revisionId !== undefined && revision.revisionId !== expected.revisionId)
    return false;
  if (expected.revisionVersion !== undefined) {
    return revision.revisionVersion === expected.revisionVersion;
  }
  return (
    revision.revisionVersion >= expected.minimumRevisionVersion &&
    revision.revisionVersion <= expected.maximumRevisionVersion
  );
}

function processedNodeMaximum(perQuantumMaximum, advancedQuanta) {
  const product = perQuantumMaximum * advancedQuanta;
  return Number.isSafeInteger(product) ? product : Number.MAX_SAFE_INTEGER;
}
