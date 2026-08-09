import {
  requireContinuationBatchLimit,
  requireContinuationTargetSpreadIndex,
  requireRevisionHandle,
  requireRevisionTransferCount,
} from './core-wasm-versioned-validation-runtime.js';
import { requireRevisionPresentation } from './revision-presentation-validation-runtime.js';
import {
  requireTextCaretResponse,
  requireTextPointRequest,
} from './reader-worker-exact-text-interaction-validation-runtime.js';
import {
  requireTextRangeRequest,
  requireTextRangeResponse,
} from './reader-worker-exact-text-range-validation-runtime.js';
import {
  requireTextRangeFromPointsRequest,
  requireTextRangeFromPointsResponse,
  requireTextRangeToPointRequest,
  requireTextRangeToPointResponse,
} from './reader-worker-text-range-from-points-validation-runtime.js';
import {
  requireTextSelectionMovementRequest,
  requireTextSelectionMovementResponse,
} from './reader-worker-text-selection-movement-validation-runtime.js';
import {
  requireExactSourceRangeRequest,
  requireExactSourceRangeResponse,
} from './reader-worker-exact-source-range-validation-runtime.js';
import { pageSemanticsResponse } from './reader-worker-page-semantics-runtime.js';
import { pageReadingAnchorResponse } from './reader-worker-page-reading-anchor-runtime.js';
import {
  requireFootnote,
  requireFootnoteKey,
  requireLocatorRequest,
  requirePageIndex,
  requirePageTargets,
  requireResolvedLocator,
  requireSourceLocatorRequest,
  requireSourceLocatorResolution,
} from './reader-worker-interaction-validation-runtime.js';
import {
  requirePageTextPositions,
  requireTextRangeGeometry,
  requireTextRangeGeometryRequest,
} from './reader-worker-text-geometry-validation-runtime.js';
import {
  requireChapterTextIndices,
  requireFootnotes,
  requireReaderRevisionBundle,
  requireSearchRequest,
  requireSearchResponse,
} from './reader-worker-versioned-read-validation-runtime.js';
import {
  requireFontVerticalMetricCalibrationRequest,
  requireFontVerticalMetricCalibrationTransferResult,
} from './font-vertical-metric-calibration-validation-runtime.js';

export function versionedReaderWorkerPayload(document, request) {
  switch (request.kind) {
    case 'createBoundedRevision':
      return advanceResponse(request.kind, document.createBoundedRevision(request.request));
    case 'continueRevision':
      return advanceResponse(
        request.kind,
        document.continueRevision({
          ...requireRevisionHandle(request.revision, request.kind),
          cursor: request.cursor,
          budget: request.budget,
        }),
      );
    case 'continueRevisionAfterTransferRelease':
      return continueRevisionAfterTransferReleaseResponse(document, request);
    case 'continueRevisionTowardSourceLocator':
      return continueRevisionTowardSourceLocatorResponse(document, request);
    case 'calibrateRevisionFontVerticalMetrics':
      return calibrateRevisionFontVerticalMetricsResponse(document, request);
    case 'cancelRevision':
      return summaryResponse(
        request.kind,
        document.cancelRevision(requireRevisionHandle(request.revision, request.kind)),
      );
    case 'getRevisionSummaryAtRevision':
      return valueResponse(request.kind, document.getRevisionSummaryAtRevision(request.revision));
    case 'getRevisionBundleAtRevision':
      return revisionBundleResponse(document, request);
    case 'getRevisionPresentationAtRevision':
      return exactReadResponse(document, request, requireRevisionPresentation);
    case 'getShapeProvenanceDiagnosticAtRevision':
      return valueResponse(
        request.kind,
        document.getShapeProvenanceDiagnosticAtRevision(request.revision),
      );
    case 'getRevisionNavigationAtRevision':
      return valueResponse(
        request.kind,
        document.getRevisionNavigationAtRevision(request.revision),
      );
    case 'readFrameBufferAtRevision':
      return readFrameBufferAtRevision(document, request.revision, request.spreadIndex);
    case 'warmFrameWindowAtRevision':
      return valueResponse(
        request.kind,
        document.warmFrameWindowAtRevision(request.revision, request.spreadIndex),
      );
    case 'getPageTargetsAtRevision':
      return pageTargetsResponse(document, request);
    case 'getPageSemanticsAtRevision':
      return pageSemanticsResponse(document, request, validatedValueResponse);
    case 'getPageReadingAnchorAtRevision':
      return pageReadingAnchorResponse(document, request, validatedValueResponse);
    case 'getPageTextPositionsAtRevision':
      return pageTextPositionsResponse(document, request);
    case 'getTextRangeGeometryAtRevision':
      return textRangeGeometryResponse(document, request);
    case 'resolveTextCaretAtRevision':
      return textCaretResponse(document, request);
    case 'resolveTextRangeAtRevision':
      return textRangeResponse(document, request);
    case 'resolveTextRangeFromPointsAtRevision':
      return textRangeFromPointsResponse(document, request);
    case 'resolveTextRangeToPointAtRevision':
      return textRangeToPointResponse(document, request);
    case 'resolveTextSelectionMovementAtRevision':
      return textSelectionMovementResponse(document, request);
    case 'resolveExactSourceRangeAtRevision':
      return exactSourceRangeResponse(document, request);
    case 'getFootnoteAtRevision':
      return footnoteResponse(document, request);
    case 'getFootnotesAtRevision':
      return exactReadResponse(document, request, requireFootnotes);
    case 'getChapterTextIndicesAtRevision':
      return exactReadResponse(document, request, requireChapterTextIndices);
    case 'searchAtRevision':
      return searchResponse(document, request);
    case 'resolveLocatorAtRevision':
      return locatorResponse(document, request);
    case 'readResourceAtRevision':
      return readResourceAtRevision(document, request.revision, request.resourceKind, request.href);
    case 'resolveSourceLocatorAtRevision':
      return sourceLocatorResponse(document, request);
    case 'releaseRevisionTransfersAtRevision':
      return valueResponse(
        request.kind,
        document.releaseRevisionTransfersAtRevision(request.revision),
      );
    case 'releaseRevisionAtRevision':
      return valueResponse(request.kind, document.releaseRevisionAtRevision(request.revision));
    default:
      return undefined;
  }
}

export function warmVersionedReaderFrameWindow(document, requestedRevision, spreadIndex) {
  const operation = 'warmFrameWindowAtRevision';
  const revision = requireRevisionHandle(requestedRevision, operation);
  const prefetched = document.prefetchPlannedFrameResourcesAtRevision(revision, spreadIndex);
  requireSameHandle(revision, prefetched.revision, operation);
  try {
    requireFrameWindowRevision(prefetched.value, revision, spreadIndex, operation);
    const frameFaults = [];
    return {
      revision,
      value: {
        plan: prefetched.value.plan,
        // One unreadable frame (evicted by a relayout between plan and
        // read) must not abort the window: sibling spreads' bytes ride in
        // the same response. The fault stays observable so a frame that
        // never arrives is attributable, not silent.
        frames: prefetched.value.plan.spreadIndexes.flatMap((index) => {
          try {
            return [readVersionedFrameBuffer(document, revision, index)];
          } catch (error) {
            frameFaults.push({ spreadIndex: index, message: String(error).slice(0, 400) });
            return [];
          }
        }),
        spreads: prefetched.value.spreads.map((spread) => {
          const transferred = readVersionedResourcePayloadBytes(
            document,
            revision,
            spread.payloads,
          );
          return {
            spreadIndex: spread.spreadIndex,
            resources: transferred.resources,
            missingResources: [...spread.missingResources, ...transferred.missingResources],
            ...(typeof spread.prefetchError === 'string'
              ? { prefetchError: spread.prefetchError }
              : {}),
          };
        }),
        ...(frameFaults.length > 0 ? { frameFaults } : {}),
      },
    };
  } catch (error) {
    releasePlannedResourceTransfers(document, prefetched.value);
    throw error;
  }
}

function advanceResponse(kind, advance) {
  const revision = requireRevisionHandle(advance.revision, `${kind} result`);
  return { kind, revision, result: advance };
}

function calibrateRevisionFontVerticalMetricsResponse(document, request) {
  const operation = request.kind;
  const previous = requireRevisionHandle(request.revision, operation);
  const input = requireFontVerticalMetricCalibrationRequest(
    {
      ...previous,
      ...(request.continuation === undefined ? {} : { continuation: request.continuation }),
      fontVerticalMetrics: request.fontVerticalMetrics,
    },
    operation,
  );
  const calibrated = document.calibrateRevisionFontVerticalMetrics(input);
  const revision = requireRevisionHandle(calibrated.revision, `${operation} result`);
  const result = requireFontVerticalMetricCalibrationTransferResult(
    calibrated,
    previous,
    revision,
    operation,
  );
  return {
    kind: operation,
    revision,
    result,
  };
}

function continueRevisionAfterTransferReleaseResponse(document, request) {
  const operation = request.kind;
  const previous = requireRevisionHandle(request.revision, operation);
  const maximum = requireContinuationBatchLimit(request.maxQuanta, operation);
  const targetSpreadIndex = requireContinuationTargetSpreadIndex(
    request.targetSpreadIndex,
    operation,
  );
  let current = previous;
  let cursor = request.cursor;
  let advance;
  let revision;
  let previousKnownExtent;
  let processedTopLevelNodes = 0;
  let releasedTransferCount = 0;
  let advancedQuanta = 0;
  while (advancedQuanta < maximum) {
    try {
      advance = document.continueRevision({
        ...current,
        cursor,
        budget: request.budget,
      });
    } catch (error) {
      if (isCommittedNextFailure(error, current)) {
        bestEffortReleaseRevisionTransfers(document, current);
      } else if (advancedQuanta > 0) {
        bestEffortReleaseRevision(document, current);
      }
      throw error;
    }
    revision = requireRevisionHandle(advance.revision, `${operation} result`);
    previousKnownExtent ??= advance.previousKnownExtent;
    processedTopLevelNodes = addSafeCount(
      processedTopLevelNodes,
      advance.processedTopLevelNodes,
      `${operation} processed top-level node count`,
    );
    try {
      releasedTransferCount = addSafeCount(
        releasedTransferCount,
        releaseRevisionTransfers(document, current, operation),
        `${operation} released transfer count`,
      );
    } catch (error) {
      bestEffortReleaseRevision(document, revision);
      throw error;
    }
    advancedQuanta += 1;
    if (advance.continuation === undefined || spreadTargetIsAvailable(advance, targetSpreadIndex)) {
      break;
    }
    current = revision;
    cursor = advance.continuation.cursor;
  }
  const aggregateAdvance = aggregateRevisionAdvance(
    advance,
    previousKnownExtent,
    processedTopLevelNodes,
  );
  return {
    kind: operation,
    revision,
    result: {
      advance: aggregateAdvance,
      releasedRevision: previous,
      releasedTransferCount,
      advancedQuanta,
    },
  };
}

function releaseRevisionTransfers(document, revision, operation) {
  const released = document.releaseRevisionTransfersAtRevision(revision);
  requireSameHandle(revision, released.revision, `${operation} release`);
  return requireRevisionTransferCount(released.value, operation);
}

function addSafeCount(total, addition, operation) {
  const result = total + addition;
  if (!Number.isSafeInteger(addition) || addition < 0 || !Number.isSafeInteger(result)) {
    throw new Error(`${operation} overflowed`);
  }
  return result;
}

function spreadTargetIsAvailable(advance, targetSpreadIndex) {
  return (
    targetSpreadIndex !== undefined && advance.revision.knownExtent.spreadCount > targetSpreadIndex
  );
}

function aggregateRevisionAdvance(finalAdvance, previousKnownExtent, processedTopLevelNodes) {
  return {
    ...finalAdvance,
    previousKnownExtent,
    newlyKnownPages: {
      startPage: previousKnownExtent.pageCount,
      endPageExclusive: finalAdvance.revision.knownExtent.pageCount,
    },
    processedTopLevelNodes,
  };
}

function isCommittedNextFailure(error, previous) {
  return (
    error?.code === 'engine-error' &&
    error.revision?.status === 'failed' &&
    error.revision.revisionId === previous.revisionId &&
    error.revision.revisionVersion === previous.revisionVersion + 1
  );
}

function bestEffortReleaseRevisionTransfers(document, revision) {
  try {
    document.releaseRevisionTransfersAtRevision(revision);
  } catch {
    // Preserve the committed continuation failure and its exact recovery revision.
  }
}

function bestEffortReleaseRevision(document, revision) {
  try {
    document.releaseRevisionAtRevision(revision);
  } catch {
    // Preserve the post-commit release failure after exact rollback is attempted.
  }
}

function continueRevisionTowardSourceLocatorResponse(document, request) {
  const operation = request.kind;
  const previous = requireRevisionHandle(request.revision, operation);
  const locator = requireSourceLocatorRequest(request.locator, operation);
  const maximum = requireContinuationBatchLimit(request.maxQuanta, operation);
  let current = previous;
  let cursor = request.cursor;
  let result;
  let revision;
  let previousKnownExtent;
  let processedTopLevelNodes = 0;
  let releasedTransferCount = 0;
  let advancedQuanta = 0;
  while (advancedQuanta < maximum) {
    try {
      result = document.continueRevisionTowardSourceLocator({
        ...current,
        cursor,
        budget: request.budget,
        locator,
      });
    } catch (error) {
      if (advancedQuanta > 0 && !isCommittedNextFailure(error, current)) {
        bestEffortReleaseRevision(document, current);
      }
      throw error;
    }
    revision = requireRevisionHandle(result.advance?.revision, `${operation} result`);
    previousKnownExtent ??= result.advance.previousKnownExtent;
    processedTopLevelNodes = addSafeCount(
      processedTopLevelNodes,
      result.advance.processedTopLevelNodes,
      `${operation} processed top-level node count`,
    );
    releasedTransferCount = addSafeCount(
      releasedTransferCount,
      requireRevisionTransferCount(result.releasedTransferCount, operation),
      `${operation} released transfer count`,
    );
    advancedQuanta += 1;
    if (locatorBatchIsComplete(result) || result.advance.continuation === undefined) break;
    current = revision;
    cursor = result.advance.continuation.cursor;
  }
  const aggregateAdvance = aggregateRevisionAdvance(
    result.advance,
    previousKnownExtent,
    processedTopLevelNodes,
  );
  return {
    kind: operation,
    revision,
    result: {
      ...result,
      advance: aggregateAdvance,
      releasedRevision: previous,
      releasedTransferCount,
      advancedQuanta,
    },
  };
}

function locatorBatchIsComplete(result) {
  if (result.locatorOutcome?.kind === 'failed') return true;
  const resolution = result.locatorOutcome?.resolution;
  return resolution?.status === 'resolved' || resolution?.reason === 'noPageProjection';
}

function summaryResponse(kind, summary) {
  const revision = requireRevisionHandle(summary, `${kind} result`);
  return { kind, revision, result: summary };
}

function valueResponse(kind, envelope) {
  const revision = requireRevisionHandle(envelope.revision, `${kind} result`);
  return { kind, revision, result: envelope.value };
}

function pageTargetsResponse(document, request) {
  const operation = request.kind;
  const revision = requireRevisionHandle(request.revision, operation);
  const pageIndex = requirePageIndex(request.pageIndex, operation);
  const envelope = document.getPageTargetsAtRevision(revision, pageIndex);
  return validatedValueResponse(operation, revision, envelope, (value) =>
    requirePageTargets(value, revision, pageIndex, operation),
  );
}

function pageTextPositionsResponse(document, request) {
  const operation = request.kind;
  const revision = requireRevisionHandle(request.revision, operation);
  const pageIndex = requirePageIndex(request.pageIndex, operation);
  const envelope = document.getPageTextPositionsAtRevision(revision, pageIndex);
  return validatedValueResponse(operation, revision, envelope, (value) =>
    requirePageTextPositions(value, revision, pageIndex, operation),
  );
}

function textRangeGeometryResponse(document, request) {
  const operation = request.kind;
  const revision = requireRevisionHandle(request.revision, operation);
  const expectedRequest = requireTextRangeGeometryRequest(request.request, operation);
  const envelope = document.getTextRangeGeometryAtRevision(revision, expectedRequest);
  return validatedValueResponse(operation, revision, envelope, (value) => ({
    request: expectedRequest,
    geometry: requireTextRangeGeometry(value, revision, expectedRequest, operation),
  }));
}

function textCaretResponse(document, request) {
  const operation = request.kind;
  const revision = requireRevisionHandle(request.revision, operation);
  const expectedRequest = requireTextPointRequest(request.request, operation);
  const envelope = document.resolveTextCaretAtRevision(revision, expectedRequest);
  return validatedValueResponse(operation, revision, envelope, (value) => ({
    request: expectedRequest,
    response: requireTextCaretResponse(value, revision, expectedRequest, operation),
  }));
}

function textRangeResponse(document, request) {
  const operation = request.kind;
  const revision = requireRevisionHandle(request.revision, operation);
  const expectedRequest = requireTextRangeRequest(request.request, operation);
  const envelope = document.resolveTextRangeAtRevision(revision, expectedRequest);
  return validatedValueResponse(operation, revision, envelope, (value) => ({
    request: expectedRequest,
    response: requireTextRangeResponse(value, revision, expectedRequest, operation),
  }));
}

function textRangeFromPointsResponse(document, request) {
  const operation = request.kind;
  const revision = requireRevisionHandle(request.revision, operation);
  const expectedRequest = requireTextRangeFromPointsRequest(request.request, operation);
  const envelope = document.resolveTextRangeFromPointsAtRevision(revision, expectedRequest);
  return validatedValueResponse(operation, revision, envelope, (value) => ({
    request: expectedRequest,
    response: requireTextRangeFromPointsResponse(value, revision, expectedRequest, operation),
  }));
}

function textRangeToPointResponse(document, request) {
  const operation = request.kind;
  const revision = requireRevisionHandle(request.revision, operation);
  const expectedRequest = requireTextRangeToPointRequest(request.request, operation);
  const envelope = document.resolveTextRangeToPointAtRevision(revision, expectedRequest);
  return validatedValueResponse(operation, revision, envelope, (value) => ({
    request: expectedRequest,
    response: requireTextRangeToPointResponse(value, revision, expectedRequest, operation),
  }));
}

function textSelectionMovementResponse(document, request) {
  const operation = request.kind;
  const revision = requireRevisionHandle(request.revision, operation);
  const expectedRequest = requireTextSelectionMovementRequest(request.request, operation);
  const envelope = document.resolveTextSelectionMovementAtRevision(revision, expectedRequest);
  return validatedValueResponse(operation, revision, envelope, (value) => ({
    request: expectedRequest,
    response: requireTextSelectionMovementResponse(value, revision, expectedRequest, operation),
  }));
}

function exactSourceRangeResponse(document, request) {
  const operation = request.kind;
  const revision = requireRevisionHandle(request.revision, operation);
  const expectedRequest = requireExactSourceRangeRequest(request.request, operation);
  const envelope = document.resolveExactSourceRangeAtRevision(revision, expectedRequest);
  return validatedValueResponse(operation, revision, envelope, (value) => ({
    request: expectedRequest,
    response: requireExactSourceRangeResponse(value, revision, expectedRequest, operation),
  }));
}

function footnoteResponse(document, request) {
  const operation = request.kind;
  const revision = requireRevisionHandle(request.revision, operation);
  const key = requireFootnoteKey(request.key, operation);
  const envelope = document.getFootnoteAtRevision(revision, key);
  return validatedValueResponse(operation, revision, envelope, (value) =>
    requireFootnote(value, revision, key, operation),
  );
}

function revisionBundleResponse(document, request) {
  const operation = request.kind;
  const revision = requireRevisionHandle(request.revision, operation);
  const envelope = document.getRevisionBundleAtRevision(
    revision,
    request.includeTocTargets === true,
  );
  return validatedValueResponse(operation, revision, envelope, (value) =>
    requireReaderRevisionBundle(value, revision, operation),
  );
}

function exactReadResponse(document, request, validate) {
  const operation = request.kind;
  const revision = requireRevisionHandle(request.revision, operation);
  const envelope = document[operation](revision);
  return validatedValueResponse(operation, revision, envelope, (value) =>
    validate(value, revision, operation),
  );
}

function searchResponse(document, request) {
  const operation = request.kind;
  const revision = requireRevisionHandle(request.revision, operation);
  const expectedRequest = requireSearchRequest(request.request, operation);
  const envelope = document.searchAtRevision(revision, expectedRequest);
  return validatedValueResponse(operation, revision, envelope, (value) =>
    requireSearchResponse(value, revision, expectedRequest, operation),
  );
}

function locatorResponse(document, request) {
  const operation = request.kind;
  const revision = requireRevisionHandle(request.revision, operation);
  const locator = requireLocatorRequest(request.locator, operation);
  const envelope = document.resolveLocatorAtRevision(revision, locator);
  return validatedValueResponse(operation, revision, envelope, (value) =>
    requireResolvedLocator(value, revision, locator, operation),
  );
}

function sourceLocatorResponse(document, request) {
  const operation = request.kind;
  const revision = requireRevisionHandle(request.revision, operation);
  const locator = requireSourceLocatorRequest(request.locator, operation);
  const result = sourceLocatorValue(document, operation, revision, locator);
  return { kind: operation, revision, result };
}

function sourceLocatorValue(document, operation, revision, locator) {
  const envelope = document.resolveSourceLocatorAtRevision(revision, locator);
  requireSameHandle(revision, envelope.revision, operation);
  return {
    request: locator,
    resolution: requireSourceLocatorResolution(envelope.value, revision, operation),
  };
}

function validatedValueResponse(kind, expected, envelope, validate) {
  requireSameHandle(expected, envelope.revision, kind);
  return { kind, revision: expected, result: validate(envelope.value) };
}

function readFrameBufferAtRevision(document, revision, spreadIndex) {
  const expected = requireRevisionHandle(revision, 'readFrameBufferAtRevision');
  const metadata = document.getFrameCommandBufferMetadataAtRevision(revision, spreadIndex);
  const bytes = document.readFrameCommandBufferAtRevision(revision, spreadIndex);
  requireSameHandle(expected, metadata.revision, 'readFrameBufferAtRevision metadata');
  requireSameHandle(metadata.revision, bytes.revision, 'readFrameBufferAtRevision');
  requireFrameMetadata(metadata.value, expected, spreadIndex, 'readFrameBufferAtRevision');
  return {
    kind: 'readFrameBufferAtRevision',
    revision: expected,
    result: { metadata: metadata.value, bytes: bytes.value },
  };
}

function readVersionedFrameBuffer(document, revision, spreadIndex) {
  const metadata = document.getFrameCommandBufferMetadataAtRevision(revision, spreadIndex);
  requireSameHandle(revision, metadata.revision, 'warmFrameWindowAtRevision metadata');
  requireFrameMetadata(metadata.value, revision, spreadIndex, 'warmFrameWindowAtRevision');
  const bytes = document.readFrameCommandBufferAtRevision(revision, spreadIndex);
  requireSameHandle(revision, bytes.revision, 'warmFrameWindowAtRevision bytes');
  return { metadata: metadata.value, bytes: bytes.value };
}

function requireFrameMetadata(metadata, revision, spreadIndex, operation) {
  requireRevisionId(metadata, revision, `${operation} metadata`);
  if (metadata.spreadIndex !== spreadIndex) {
    throw new Error(`${operation} metadata received a mismatched spreadIndex`);
  }
}

function readResourceAtRevision(document, revision, kind, href) {
  const payload = document.getResourcePayloadAtRevision(revision, kind, href);
  return {
    kind: 'readResourceAtRevision',
    revision: payload.revision,
    result: {
      payload: payload.value,
      bytes: takeResourceTransferBytes(document, payload.value.transferId),
    },
  };
}

function requireSameHandle(left, right, operation) {
  const expected = requireRevisionHandle(left, operation);
  const actual = requireRevisionHandle(right, operation);
  if (
    expected.revisionId !== actual.revisionId ||
    expected.revisionVersion !== actual.revisionVersion
  ) {
    throw new Error(`${operation} received mismatched versioned responses`);
  }
}

function requireFrameWindowRevision(prefetched, revision, requestedSpreadIndex, operation) {
  const plan = prefetched?.plan;
  requireRevisionId(plan, revision, `${operation} plan`);
  if (
    plan.centerSpreadIndex !== requestedSpreadIndex ||
    plan.displaySpreadIndex !== requestedSpreadIndex
  ) {
    throw new Error(`${operation} received a plan for a mismatched spreadIndex`);
  }
  if (!Array.isArray(plan.spreadIndexes) || !Array.isArray(prefetched.spreads)) {
    throw new Error(`${operation} received a malformed frame window plan`);
  }
  const indexes = new Set();
  for (const spreadIndex of plan.spreadIndexes) {
    if (!Number.isSafeInteger(spreadIndex) || spreadIndex < 0 || indexes.has(spreadIndex)) {
      throw new Error(`${operation} received invalid frame window spread indexes`);
    }
    indexes.add(spreadIndex);
  }
  if (prefetched.spreads.length !== plan.spreadIndexes.length) {
    throw new Error(`${operation} received resources inconsistent with its frame window plan`);
  }
  for (const [index, spread] of prefetched.spreads.entries()) {
    requireRevisionId(spread, revision, `${operation} spread`);
    if (spread.spreadIndex !== plan.spreadIndexes[index]) {
      throw new Error(`${operation} received resources for a mismatched spreadIndex`);
    }
    if (!Array.isArray(spread.payloads) || !Array.isArray(spread.missingResources)) {
      throw new Error(`${operation} received malformed frame window resources`);
    }
    const hrefs = new Set();
    for (const payload of spread.payloads) {
      requireRevisionId(payload, revision, `${operation} resource`);
      const href = requireFrameResourceIdentity(payload, `${operation} resource`);
      if (hrefs.has(href)) {
        throw new Error(`${operation} received duplicate frame window resources`);
      }
      hrefs.add(href);
    }
    for (const missing of spread.missingResources) {
      const href = requireMissingFrameResource(missing, operation);
      if (hrefs.has(href)) {
        throw new Error(`${operation} received conflicting frame window resource results`);
      }
      hrefs.add(href);
    }
  }
}

function requireRevisionId(value, revision, operation) {
  if (value === null || typeof value !== 'object' || value.revisionId !== revision.revisionId) {
    throw new Error(`${operation} received a mismatched revisionId`);
  }
}

function readVersionedResourcePayloadBytes(document, revision, payloads) {
  const resources = [];
  const missingResources = [];
  for (const payload of payloads) {
    requireRevisionId(payload, revision, 'warmFrameWindowAtRevision resource');
    try {
      resources.push({ payload, bytes: takeResourceTransferBytes(document, payload.transferId) });
    } catch {
      missingResources.push({
        kind: payload.kind,
        href: payload.href,
        message: `Frame resource transfer is unavailable: ${payload.href}`,
      });
    }
  }
  return { resources, missingResources };
}

function requireFrameResourceIdentity(value, operation) {
  if (
    value === null ||
    typeof value !== 'object' ||
    value.kind !== 'image' ||
    typeof value.href !== 'string' ||
    value.href.length === 0
  ) {
    throw new Error(`${operation} received a malformed frame image resource`);
  }
  return value.href;
}

function requireMissingFrameResource(value, operation) {
  if (
    value === null ||
    typeof value !== 'object' ||
    value.kind !== 'image' ||
    typeof value.href !== 'string' ||
    value.href.length === 0 ||
    typeof value.message !== 'string' ||
    value.message.length === 0
  ) {
    throw new Error(`${operation} received a malformed missing frame image resource`);
  }
  return value.href;
}

function releasePlannedResourceTransfers(document, prefetched) {
  for (const spread of Array.isArray(prefetched?.spreads) ? prefetched.spreads : []) {
    for (const payload of Array.isArray(spread?.payloads) ? spread.payloads : []) {
      if (typeof payload?.transferId !== 'string') continue;
      try {
        document.releaseResourceTransfer(payload.transferId);
      } catch {
        // Preserve the frame-window failure; cleanup is best effort.
      }
    }
  }
}

function takeResourceTransferBytes(document, transferId) {
  try {
    return document.takeResourceTransfer(transferId);
  } catch (error) {
    try {
      document.releaseResourceTransfer(transferId);
    } catch {
      // Preserve the transfer read failure; cleanup is best effort.
    }
    throw error;
  }
}
