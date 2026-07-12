import { requireRevisionHandle } from './core-wasm-versioned-validation-runtime.js';
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
    case 'cancelRevision':
      return summaryResponse(
        request.kind,
        document.cancelRevision(requireRevisionHandle(request.revision, request.kind)),
      );
    case 'getRevisionSummaryAtRevision':
      return valueResponse(request.kind, document.getRevisionSummaryAtRevision(request.revision));
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
    case 'getPageTextPositionsAtRevision':
      return pageTextPositionsResponse(document, request);
    case 'getTextRangeGeometryAtRevision':
      return textRangeGeometryResponse(document, request);
    case 'getFootnoteAtRevision':
      return footnoteResponse(document, request);
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
    return {
      revision,
      value: {
        plan: prefetched.value.plan,
        frames: prefetched.value.plan.spreadIndexes.map((index) =>
          readVersionedFrameBuffer(document, revision, index),
        ),
        spreads: prefetched.value.spreads.map((spread) => ({
          spreadIndex: spread.spreadIndex,
          resources: readVersionedResourcePayloadBytes(document, revision, spread.payloads),
        })),
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

function footnoteResponse(document, request) {
  const operation = request.kind;
  const revision = requireRevisionHandle(request.revision, operation);
  const key = requireFootnoteKey(request.key, operation);
  const envelope = document.getFootnoteAtRevision(revision, key);
  return validatedValueResponse(operation, revision, envelope, (value) =>
    requireFootnote(value, revision, key, operation),
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
  const envelope = document.resolveSourceLocatorAtRevision(revision, locator);
  return validatedValueResponse(operation, revision, envelope, (value) =>
    requireSourceLocatorResolution(value, revision, operation),
  );
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
    if (!Array.isArray(spread.payloads)) {
      throw new Error(`${operation} received malformed frame window resources`);
    }
    for (const payload of spread.payloads) {
      requireRevisionId(payload, revision, `${operation} resource`);
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
  for (const payload of payloads) {
    requireRevisionId(payload, revision, 'warmFrameWindowAtRevision resource');
    try {
      resources.push({ payload, bytes: takeResourceTransferBytes(document, payload.transferId) });
    } catch {
      // Frame resource warmup is opportunistic. Missing bytes should not fail callers.
    }
  }
  return resources;
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
