import { requireRevisionHandle } from './core-wasm-versioned-validation-runtime.js';

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
    case 'getRevisionNavigationAtRevision':
      return valueResponse(
        request.kind,
        document.getRevisionNavigationAtRevision(request.revision),
      );
    case 'readFrameBufferAtRevision':
      return readFrameBufferAtRevision(document, request.revision, request.spreadIndex);
    case 'readResourceAtRevision':
      return readResourceAtRevision(document, request.revision, request.resourceKind, request.href);
    case 'resolveSourceLocatorAtRevision':
      return valueResponse(
        request.kind,
        document.resolveSourceLocatorAtRevision(request.revision, request.locator),
      );
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

function readFrameBufferAtRevision(document, revision, spreadIndex) {
  const metadata = document.getFrameCommandBufferMetadataAtRevision(revision, spreadIndex);
  const bytes = document.readFrameCommandBufferAtRevision(revision, spreadIndex);
  requireSameHandle(metadata.revision, bytes.revision, 'readFrameBufferAtRevision');
  return {
    kind: 'readFrameBufferAtRevision',
    revision: metadata.revision,
    result: { metadata: metadata.value, bytes: bytes.value },
  };
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
