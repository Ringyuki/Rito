import { callRitoCoreWasm } from './core-wasm-error-runtime.js';
import {
  encodeJson,
  parseObject,
  requireFlatRevisionHandle,
  requireInitialRevisionAdvance,
  requireMatchingHandle,
  requireMatchingRevisionSummary,
  requireObjectInput,
  requireRevisionAdvance,
  requireRevisionBundle,
  requireRevisionHandle,
  requireRevisionSummary,
  requireRevisionWorkBudget,
  requireVersionedValueIdentity,
} from './core-wasm-versioned-validation-runtime.js';

export function installRitoCoreWasmVersionedDocumentMethods(Document) {
  const methods = {
    createBoundedRevision(request) {
      return boundedRequest(
        this,
        'createBoundedRevision',
        request,
        'createBoundedRevisionJson',
        undefined,
        0,
      );
    },
    continueRevision(request) {
      const input = requireObjectInput(request, 'continueRevision');
      const handle = requireFlatRevisionHandle(input, 'continueRevision');
      return boundedRequest(
        this,
        'continueRevision',
        input,
        'continueRevisionJson',
        handle.revisionId,
        handle.revisionVersion + 1,
      );
    },
    cancelRevision(request) {
      const input = requireObjectInput(request, 'cancelRevision');
      const handle = requireFlatRevisionHandle(input, 'cancelRevision');
      return callRitoCoreWasm('cancelRevision', () =>
        requireRevisionSummary(
          parseObject(
            this._inner.cancelRevisionJson(encodeJson(input, 'cancelRevision')),
            'cancelRevision',
          ),
          'cancelRevision',
          handle.revisionId,
          handle.revisionVersion + 1,
          'cancelled',
        ),
      );
    },
    getFrameAtRevision(handle, spreadIndex) {
      return versionedJson(this, 'getFrameAtRevision', handle, (revision) =>
        this._inner.getFrameAtRevisionJson(
          revision.revisionId,
          revision.revisionVersion,
          spreadIndex,
        ),
      );
    },
    getFrameCommandBufferMetadataAtRevision(handle, spreadIndex) {
      return versionedJson(this, 'getFrameCommandBufferMetadataAtRevision', handle, (revision) =>
        this._inner.getFrameCommandBufferMetadataAtRevisionJson(
          revision.revisionId,
          revision.revisionVersion,
          spreadIndex,
        ),
      );
    },
    readFrameCommandBufferAtRevision(handle, spreadIndex) {
      return versionedBytes(this, 'readFrameCommandBufferAtRevision', handle, (revision) =>
        this._inner.readFrameCommandBufferAtRevision(
          revision.revisionId,
          revision.revisionVersion,
          spreadIndex,
        ),
      );
    },
    getResourcePayloadAtRevision(handle, kind, href) {
      return versionedJson(this, 'getResourcePayloadAtRevision', handle, (revision) =>
        this._inner.getResourcePayloadAtRevisionJson(
          revision.revisionId,
          revision.revisionVersion,
          kind,
          href,
        ),
      );
    },
    prefetchResourcesAtRevision(handle, request) {
      return versionedRequest(
        this,
        'prefetchResourcesAtRevision',
        handle,
        request,
        (revision, json) =>
          this._inner.prefetchResourcesAtRevisionJson(
            revision.revisionId,
            revision.revisionVersion,
            json,
          ),
      );
    },
    prefetchPlannedFrameResourcesAtRevision(handle, spreadIndex) {
      return versionedJson(this, 'prefetchPlannedFrameResourcesAtRevision', handle, (revision) =>
        this._inner.prefetchPlannedFrameResourcesAtRevisionJson(
          revision.revisionId,
          revision.revisionVersion,
          spreadIndex,
        ),
      );
    },
    searchAtRevision(handle, request) {
      return versionedRequest(this, 'searchAtRevision', handle, request, (revision, json) =>
        this._inner.searchAtRevisionJson(revision.revisionId, revision.revisionVersion, json),
      );
    },
    resolveLocatorAtRevision(handle, request) {
      return versionedRequest(this, 'resolveLocatorAtRevision', handle, request, (revision, json) =>
        this._inner.resolveLocatorAtRevisionJson(
          revision.revisionId,
          revision.revisionVersion,
          json,
        ),
      );
    },
    resolveSourceLocatorAtRevision(handle, request) {
      return versionedRequest(
        this,
        'resolveSourceLocatorAtRevision',
        handle,
        request,
        (revision, json) =>
          this._inner.resolveSourceLocatorAtRevisionJson(
            revision.revisionId,
            revision.revisionVersion,
            json,
          ),
      );
    },
    getPageTargetsAtRevision(handle, pageIndex) {
      return versionedIndex(this, 'getPageTargetsAtRevision', handle, pageIndex);
    },
    getPageTextPositionsAtRevision(handle, pageIndex) {
      return versionedIndex(this, 'getPageTextPositionsAtRevision', handle, pageIndex);
    },
    getTextRangeGeometryAtRevision(handle, request) {
      return versionedRequest(
        this,
        'getTextRangeGeometryAtRevision',
        handle,
        request,
        (revision, json) =>
          this._inner.getTextRangeGeometryAtRevisionJson(
            revision.revisionId,
            revision.revisionVersion,
            json,
          ),
      );
    },
    getFootnoteAtRevision(handle, key) {
      return versionedJson(this, 'getFootnoteAtRevision', handle, (revision) =>
        this._inner.getFootnoteAtRevisionJson(revision.revisionId, revision.revisionVersion, key),
      );
    },
    getFootnotesAtRevision(handle) {
      return versionedNoArg(this, 'getFootnotesAtRevision', handle);
    },
    getChapterTextIndicesAtRevision(handle) {
      return versionedNoArg(this, 'getChapterTextIndicesAtRevision', handle);
    },
    getRevisionSummaryAtRevision(handle) {
      return versionedNoArg(this, 'getRevisionSummaryAtRevision', handle, requireSummaryValue);
    },
    getRevisionBundleAtRevision(handle, includeTocTargets = false) {
      return versionedJson(
        this,
        'getRevisionBundleAtRevision',
        handle,
        (revision) =>
          this._inner.getRevisionBundleAtRevisionJson(
            revision.revisionId,
            revision.revisionVersion,
            includeTocTargets === true,
          ),
        requireRevisionBundle,
      );
    },
    getRevisionNavigationAtRevision(handle) {
      return versionedNoArg(this, 'getRevisionNavigationAtRevision', handle);
    },
    releaseRevisionTransfersAtRevision(handle) {
      return versionedNoArg(this, 'releaseRevisionTransfersAtRevision', handle);
    },
    releaseRevisionAtRevision(handle) {
      return versionedNoArg(this, 'releaseRevisionAtRevision', handle);
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

function boundedRequest(
  document,
  operation,
  request,
  rawMethod,
  expectedRevisionId,
  expectedRevisionVersion,
) {
  return callRitoCoreWasm(operation, () => {
    const input = requireObjectInput(request, operation);
    const maximum = requireRevisionWorkBudget(input.budget, operation);
    const result = parseObject(document._inner[rawMethod](encodeJson(input, operation)), operation);
    const revision = requireRevisionSummary(
      result.revision,
      operation,
      expectedRevisionId,
      expectedRevisionVersion,
    );
    return operation === 'createBoundedRevision'
      ? requireInitialRevisionAdvance(result, revision, operation, maximum)
      : requireRevisionAdvance(result, revision, operation, maximum);
  });
}

function versionedRequest(document, operation, handle, request, read) {
  const input = requireObjectInput(request, operation);
  return versionedJson(document, operation, handle, (revision) =>
    read(revision, encodeJson(input, operation)),
  );
}

function versionedIndex(document, operation, handle, index) {
  const rawMethod = `${operation}Json`;
  return versionedJson(document, operation, handle, (revision) =>
    document._inner[rawMethod](revision.revisionId, revision.revisionVersion, index),
  );
}

function versionedNoArg(document, operation, handle, validateValue) {
  const rawMethod = operation.startsWith('release') ? operation : `${operation}Json`;
  return versionedJson(
    document,
    operation,
    handle,
    (revision) => document._inner[rawMethod](revision.revisionId, revision.revisionVersion),
    validateValue,
  );
}

function versionedJson(document, operation, handle, read, validateValue) {
  return callRitoCoreWasm(operation, () => {
    const expected = requireRevisionHandle(handle, operation);
    const payload = parseObject(read(expected), operation);
    const revision = requireMatchingHandle(payload.revision, expected, operation);
    if (!Object.prototype.hasOwnProperty.call(payload, 'value')) {
      throw new Error(`${operation} returned a versioned payload without value`);
    }
    requireVersionedValueIdentity(payload.value, revision, operation);
    const value = validateValue?.(payload.value, revision, operation) ?? payload.value;
    return { revision, value };
  });
}

function versionedBytes(document, operation, handle, read) {
  return callRitoCoreWasm(operation, () => {
    const revision = requireRevisionHandle(handle, operation);
    const value = read(revision);
    if (!(value instanceof Uint8Array)) {
      throw new Error(`${operation} returned a non-Uint8Array command buffer`);
    }
    return { revision, value };
  });
}

function requireSummaryValue(value, revision, operation) {
  return requireMatchingRevisionSummary(value, revision, operation);
}
