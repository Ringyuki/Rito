import { callRitoCoreWasm } from './core-wasm-error-runtime.js';
import { encodeJson, parseObject } from './core-wasm-versioned-validation-runtime.js';
import {
  requireChapterLocalRelease,
  requireContinuedChapterLocalAdvance,
  requireCreatedChapterLocalAdvance,
} from './chapter-local-advance-validation-runtime.js';
import {
  requireBoundedChapterLocalRequest,
  requireChapterLocalIndex,
  requireChapterLocalOwner,
  requireContinueChapterLocalRequest,
  nextChapterLocalOwner,
} from './chapter-local-owner-validation-runtime.js';
import {
  requireChapterLocalFrameBuffer,
  requireChapterLocalFrameResources,
  requireChapterLocalResourceTransferBytes,
  requireRawChapterLocalResourcePrefetch,
} from './chapter-local-frame-validation-runtime.js';

export function installRitoCoreWasmChapterLocalDocumentMethods(Document) {
  const methods = {
    createBoundedChapterLocalRevision(request) {
      const operation = 'createBoundedChapterLocalRevision';
      return callRitoCoreWasm(operation, () => {
        const normalized = requireBoundedChapterLocalRequest(request, operation);
        return committedChapterLocalMutation(
          this,
          operation,
          undefined,
          () =>
            this._inner.createBoundedChapterLocalRevisionJson(
              encodeJson(normalized.request, operation),
            ),
          (value, bindOwner) =>
            requireCreatedChapterLocalAdvance(
              value,
              normalized.request,
              normalized.maximum,
              operation,
              bindOwner,
            ),
        );
      });
    },
    continueChapterLocalRevision(request) {
      const operation = 'continueChapterLocalRevision';
      return callRitoCoreWasm(operation, () => {
        const normalized = requireContinueChapterLocalRequest(request, operation);
        const rollbackOwner = nextChapterLocalOwner(
          normalized.request.continuation.owner,
          operation,
        );
        return committedChapterLocalMutation(
          this,
          operation,
          rollbackOwner,
          () =>
            this._inner.continueChapterLocalRevisionJson(encodeJson(normalized.request, operation)),
          (value, bindOwner) =>
            requireContinuedChapterLocalAdvance(
              value,
              normalized.request,
              normalized.maximum,
              operation,
              bindOwner,
            ),
        );
      });
    },
    readChapterLocalFrame(owner, localSpreadIndex) {
      const operation = 'readChapterLocalFrame';
      return callRitoCoreWasm(operation, () => {
        const exactOwner = requireChapterLocalOwner(owner, operation);
        const index = requireChapterLocalIndex(localSpreadIndex, operation);
        const ownerJson = encodeJson(exactOwner, operation);
        const metadata = parseObject(
          this._inner.getChapterLocalFrameCommandBufferMetadataJson(ownerJson, index),
          operation,
        );
        const bytes = this._inner.readChapterLocalFrameCommandBuffer(ownerJson, index);
        return requireChapterLocalFrameBuffer(
          { owner: exactOwner, localSpreadIndex: index, metadata, bytes },
          exactOwner,
          index,
          operation,
        );
      });
    },
    prefetchChapterLocalFrameResources(owner, localSpreadIndex) {
      const operation = 'prefetchChapterLocalFrameResources';
      return callRitoCoreWasm(operation, () => {
        const exactOwner = requireChapterLocalOwner(owner, operation);
        const index = requireChapterLocalIndex(localSpreadIndex, operation);
        return takePrefetchedChapterLocalResources(this, exactOwner, index, operation);
      });
    },
    releaseChapterLocalRevision(owner) {
      const operation = 'releaseChapterLocalRevision';
      return callRitoCoreWasm(operation, () => {
        const exactOwner = requireChapterLocalOwner(owner, operation);
        const rawPayload = this._inner.releaseChapterLocalRevisionJson(
          encodeJson(exactOwner, operation),
        );
        try {
          const release = requireChapterLocalRelease(
            parseObject(rawPayload, operation),
            exactOwner,
            operation,
          );
          if (!release.releasedRevision) {
            throw new Error(`${operation} did not release its exact owner`);
          }
          return release;
        } catch (error) {
          bestEffortDisposeDocument(this);
          throw error;
        }
      });
    },
  };
  Object.defineProperties(
    Document.prototype,
    Object.fromEntries(
      Object.entries(methods).map(([name, value]) => [
        name,
        { configurable: true, value, writable: true },
      ]),
    ),
  );
}

function committedChapterLocalMutation(document, operation, fallbackOwner, invoke, validate) {
  const rawPayload = invoke();
  let boundOwner;
  try {
    const result = parseObject(rawPayload, operation);
    return validate(result, (owner) => {
      boundOwner = owner;
    });
  } catch (error) {
    containCommittedOwner(document, boundOwner ?? fallbackOwner, operation);
    throw error;
  }
}

function takePrefetchedChapterLocalResources(document, owner, localSpreadIndex, operation) {
  const ownerJson = encodeJson(owner, operation);
  const rawPayload = document._inner.prefetchChapterLocalFrameResourcesJson(
    ownerJson,
    localSpreadIndex,
  );
  let prefetched;
  try {
    prefetched = requireRawChapterLocalResourcePrefetch(
      parseObject(rawPayload, operation),
      owner,
      localSpreadIndex,
      operation,
    );
  } catch (error) {
    bestEffortDisposeDocument(document);
    throw error;
  }
  const resources = [];
  for (const [index, payload] of prefetched.payloads.entries()) {
    let bytes;
    try {
      bytes = document._inner.takeChapterLocalResourceTransfer(ownerJson, payload.transferId);
    } catch (error) {
      if (!releaseRemainingTransfers(document, ownerJson, prefetched.payloads, index)) {
        bestEffortDisposeDocument(document);
      }
      throw error;
    }
    try {
      resources.push(requireChapterLocalResourceTransferBytes(bytes, payload, operation));
    } catch (error) {
      if (!releaseRemainingTransfers(document, ownerJson, prefetched.payloads, index + 1)) {
        bestEffortDisposeDocument(document);
      }
      throw error;
    }
  }
  return requireChapterLocalFrameResources(
    {
      owner,
      localSpreadIndex,
      resources,
      missingResources: prefetched.missingResources,
    },
    owner,
    localSpreadIndex,
    operation,
  );
}

function releaseRemainingTransfers(document, ownerJson, payloads, startIndex) {
  let confirmed = true;
  for (let index = startIndex; index < payloads.length; index += 1) {
    try {
      const released = document._inner.releaseChapterLocalResourceTransfer(
        ownerJson,
        payloads[index].transferId,
      );
      if (released !== true) confirmed = false;
    } catch {
      confirmed = false;
    }
  }
  return confirmed;
}

function containCommittedOwner(document, owner, operation) {
  if (owner === undefined) {
    bestEffortDisposeDocument(document);
    return;
  }
  try {
    const release = requireChapterLocalRelease(
      parseObject(
        document._inner.releaseChapterLocalRevisionJson(encodeJson(owner, operation)),
        `${operation} rollback`,
      ),
      owner,
      `${operation} rollback`,
    );
    if (release.releasedRevision) return;
  } catch {
    // A malformed committed response remains the primary failure.
  }
  bestEffortDisposeDocument(document);
}

function bestEffortDisposeDocument(document) {
  try {
    document._inner.free();
  } catch {
    // Preserve the protocol failure after best-effort owner containment.
  }
}
