import { callRitoCoreWasm } from './core-wasm-error-runtime.js';
import { installRitoCoreWasmChapterLocalDocumentMethods } from './chapter-local-document-runtime.js';
import { installRitoCoreWasmVersionedDocumentMethods } from './core-wasm-versioned-runtime.js';
import { chapterLocalReaderWorkerPayload } from './reader-worker-chapter-local-payload-runtime.js';
import {
  versionedReaderWorkerPayload,
  warmVersionedReaderFrameWindow,
} from './reader-worker-versioned-payload-runtime.js';
import { decodePinnedFontPolicySummary, openRawDocument } from './pinned-font-policy-runtime.js';

export function createRitoCoreWasmDocumentRuntime(initRitoCoreWasm, RawRitoWasmDocument) {
  let wasmExports;
  async function initRitoCoreWasmEngine(initInput) {
    try {
      wasmExports = await initRitoCoreWasm(initInput);
    } catch (error) {
      throw callRitoCoreWasm('initRitoCoreWasmEngine', () => {
        throw error;
      });
    }
    return {
      openDocument(bytes, options) {
        return callRitoCoreWasm('openDocument', () => {
          const opened = openRawDocument(RawRitoWasmDocument, bytes, options);
          return new RitoCoreWasmDocument(opened.inner, opened.expectedFaces);
        });
      },
    };
  }

  /**
   * Current WASM linear-memory size in bytes, or 0 before initialization.
   * Linear memory never shrinks, so this is the instance's high-water mark;
   * recycling policies use it to bound how large a reused instance may grow.
   */
  function ritoCoreWasmMemoryByteLength() {
    const byteLength = wasmExports?.memory?.buffer?.byteLength;
    return typeof byteLength === 'number' ? byteLength : 0;
  }

  class RitoCoreWasmDocument {
    constructor(inner, expectedPinnedFontFaces) {
      this._inner = inner;
      this._expectedPinnedFontFaces = expectedPinnedFontFaces;
    }

    free() {
      return callRitoCoreWasm('free', () => this._inner.free());
    }

    publication() {
      return callRitoCoreWasm('publication', () =>
        parseObjectPayload(this._inner.publicationJson(), 'publication'),
      );
    }

    pinnedFontPolicy() {
      return callRitoCoreWasm('pinnedFontPolicy', () =>
        decodePinnedFontPolicySummary(
          this._inner.pinnedFontPolicyJson(),
          this._expectedPinnedFontFaces,
        ),
      );
    }

    takeHostLineMetricRequests() {
      return callRitoCoreWasm('takeHostLineMetricRequests', () =>
        JSON.parse(this._inner.takeHostLineMetricRequestsJson()),
      );
    }

    setHostLineMetrics(entries) {
      return callRitoCoreWasm('setHostLineMetrics', () => {
        this._inner.setHostLineMetricsJson(JSON.stringify(entries));
      });
    }

    setUnavailableFontFaces(families) {
      return callRitoCoreWasm('setUnavailableFontFaces', () => {
        this._inner.setUnavailableFontFacesJson(JSON.stringify(families));
      });
    }

    // Device pixels per CSS pixel frames are painted at (zoom × dpr): every
    // raster snap lands on that grid, pagination never changes with it, and
    // frames cached on the old grid are dropped engine-side.
    setRenderRatio(ratio) {
      return callRitoCoreWasm('setRenderRatio', () => {
        this._inner.setRenderRatio(ratio);
      });
    }

    chapterFragmentProbe(revisionId, idref) {
      return callRitoCoreWasm('chapterFragmentProbe', () =>
        JSON.parse(this._inner.chapterFragmentProbeJson(revisionId, idref)),
      );
    }

    getFrame(revisionId, spreadIndex) {
      return jsonMethod('getFrame', () => this._inner.getFrameJson(revisionId, spreadIndex));
    }

    getFrameCommandBufferMetadata(revisionId, spreadIndex) {
      return jsonMethod('getFrameCommandBufferMetadata', () =>
        this._inner.getFrameCommandBufferMetadataJson(revisionId, spreadIndex),
      );
    }

    readFrameCommandBuffer(revisionId, spreadIndex) {
      return callRitoCoreWasm('readFrameCommandBuffer', () =>
        this._inner.readFrameCommandBuffer(revisionId, spreadIndex),
      );
    }

    getPageTargets(revisionId, pageIndex) {
      return jsonMethod('getPageTargets', () =>
        this._inner.getPageTargetsJson(revisionId, pageIndex),
      );
    }

    getPageTextPositions(revisionId, pageIndex) {
      return jsonMethod('getPageTextPositions', () =>
        this._inner.getPageTextPositionsJson(revisionId, pageIndex),
      );
    }

    getTextRangeGeometry(revisionId, request) {
      return jsonMethod('getTextRangeGeometry', () =>
        this._inner.getTextRangeGeometryJson(
          revisionId,
          encodeJson(request, 'getTextRangeGeometry'),
        ),
      );
    }

    getFootnote(revisionId, key) {
      return jsonMethod('getFootnote', () => this._inner.getFootnoteJson(revisionId, key));
    }

    getFootnotes(revisionId) {
      return jsonMethod('getFootnotes', () => this._inner.getFootnotesJson(revisionId));
    }

    getChapterTextIndices(revisionId) {
      return jsonMethod('getChapterTextIndices', () =>
        this._inner.getChapterTextIndicesJson(revisionId),
      );
    }

    search(revisionId, request) {
      return jsonMethod('search', () =>
        this._inner.searchJson(revisionId, encodeJson(request, 'search')),
      );
    }

    resolveLocator(revisionId, request) {
      return jsonMethod('resolveLocator', () =>
        this._inner.resolveLocatorJson(revisionId, encodeJson(request, 'resolveLocator')),
      );
    }

    getResourcePayload(revisionId, kind, href) {
      return jsonMethod('getResourcePayload', () =>
        this._inner.getResourcePayloadJson(revisionId, kind, href),
      );
    }

    prefetchResources(revisionId, request) {
      return jsonMethod('prefetchResources', () =>
        this._inner.prefetchResourcesJson(revisionId, encodeJson(request, 'prefetchResources')),
      );
    }

    prefetchPlannedFrameResources(revisionId, spreadIndex) {
      return jsonMethod('prefetchPlannedFrameResources', () =>
        this._inner.prefetchPlannedFrameResourcesJson(revisionId, spreadIndex),
      );
    }

    warmFrameWindowAtRevision(revision, spreadIndex) {
      return callRitoCoreWasm('warmFrameWindowAtRevision', () =>
        warmVersionedReaderFrameWindow(this, revision, spreadIndex),
      );
    }

    readerWorkerPayload(request) {
      return callRitoCoreWasm('readerWorkerPayload', () => readerWorkerPayload(this, request));
    }

    readResourceTransfer(transferId) {
      return callRitoCoreWasm('readResourceTransfer', () =>
        this._inner.readResourceTransfer(transferId),
      );
    }

    takeResourceTransfer(transferId) {
      return callRitoCoreWasm('takeResourceTransfer', () =>
        this._inner.takeResourceTransfer(transferId),
      );
    }

    releaseResourceTransfer(transferId) {
      return callRitoCoreWasm('releaseResourceTransfer', () =>
        this._inner.releaseResourceTransfer(transferId),
      );
    }

    releaseRevisionTransfers(revisionId) {
      return callRitoCoreWasm('releaseRevisionTransfers', () =>
        this._inner.releaseRevisionTransfers(revisionId),
      );
    }

    releaseRevision(revisionId) {
      return callRitoCoreWasm('releaseRevision', () => this._inner.releaseRevision(revisionId));
    }

    pendingResourceTransferCount() {
      return callRitoCoreWasm('pendingResourceTransferCount', () =>
        this._inner.pendingResourceTransferCount(),
      );
    }
  }

  installRitoCoreWasmVersionedDocumentMethods(RitoCoreWasmDocument);
  installRitoCoreWasmChapterLocalDocumentMethods(RitoCoreWasmDocument);

  return { initRitoCoreWasmEngine, RitoCoreWasmDocument, ritoCoreWasmMemoryByteLength };
}

function readerWorkerPayload(document, request) {
  switch (request.kind) {
    case 'readResource':
      return readReaderResource(document, request.revisionId, request.resourceKind, request.href);
    case 'warmFrameWindow':
      return warmReaderFrameWindow(document, request.revisionId, request.spreadIndex);
    case 'resolveLocator':
      return resolveReaderLocator(document, request.revisionId, request.locator);
    case 'search':
      return { kind: 'search', result: document.search(request.revisionId, request.request) };
    case 'releaseRevisionTransfers':
      document.releaseRevisionTransfers(request.revisionId);
      return { kind: 'releaseRevisionTransfers' };
    case 'releaseRevision':
      document.releaseRevision(request.revisionId);
      return { kind: 'releaseRevision' };
    case 'takeHostLineMetricRequests':
      return {
        kind: 'takeHostLineMetricRequests',
        result: document.takeHostLineMetricRequests(),
      };
    case 'setHostLineMetrics':
      document.setHostLineMetrics(request.entries);
      return { kind: 'setHostLineMetrics' };
    case 'setUnavailableFontFaces':
      document.setUnavailableFontFaces(request.families);
      return { kind: 'setUnavailableFontFaces' };
    case 'setRenderRatio':
      document.setRenderRatio(request.ratio);
      return { kind: 'setRenderRatio' };
    case 'chapterFragmentProbe':
      return {
        kind: 'chapterFragmentProbe',
        result: document.chapterFragmentProbe(request.revisionId, request.idref),
      };
    default: {
      const chapterLocal = chapterLocalReaderWorkerPayload(document, request);
      if (chapterLocal !== undefined) return chapterLocal;
      const versioned = versionedReaderWorkerPayload(document, request);
      if (versioned !== undefined) return versioned;
      throw new Error(`Unsupported reader worker request: ${String(request.kind)}`);
    }
  }
}

function warmReaderFrameWindow(document, revisionId, spreadIndex) {
  const prefetched = document.prefetchPlannedFrameResources(revisionId, spreadIndex);
  return { kind: 'warmFrameWindow', result: frameWindowResult(document, prefetched) };
}

function frameWindowResult(document, prefetched) {
  const frameFaults = [];
  return {
    plan: prefetched.plan,
    // One unreadable frame (evicted by a relayout between plan and read)
    // must not abort the window: sibling spreads' bytes ride in the same
    // response. The fault stays observable so a frame that never arrives
    // is attributable, not silent.
    frames: prefetched.plan.spreadIndexes.flatMap((spreadIndex) => {
      try {
        return [readFrameBuffer(document, prefetched.plan.revisionId, spreadIndex)];
      } catch (error) {
        frameFaults.push({ spreadIndex, message: String(error).slice(0, 400) });
        return [];
      }
    }),
    spreads: prefetched.spreads.map((spread) => {
      const transferred = readResourcePayloadBytes(document, spread.payloads);
      return {
        spreadIndex: spread.spreadIndex,
        resources: transferred.resources,
        missingResources: [
          ...(Array.isArray(spread.missingResources) ? spread.missingResources : []),
          ...transferred.missingResources,
        ],
        ...(typeof spread.prefetchError === 'string'
          ? { prefetchError: spread.prefetchError }
          : {}),
      };
    }),
    ...(frameFaults.length > 0 ? { frameFaults } : {}),
  };
}

function readFrameBuffer(document, revisionId, spreadIndex) {
  return {
    metadata: document.getFrameCommandBufferMetadata(revisionId, spreadIndex),
    bytes: document.readFrameCommandBuffer(revisionId, spreadIndex),
  };
}

function readReaderResource(document, revisionId, kind, href) {
  const payload = document.getResourcePayload(revisionId, kind, href);
  return {
    kind: 'readResource',
    result: { payload, bytes: takeResourceTransferBytes(document, payload.transferId) },
  };
}

function readResourcePayloadBytes(document, payloads) {
  const resources = [];
  const missingResources = [];
  for (const payload of payloads) {
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

function resolveReaderLocator(document, revisionId, locator) {
  const href = stringProperty(locator, 'href');
  const resolved = document.resolveLocator(revisionId, { href });
  return {
    kind: 'resolveLocator',
    result: {
      entry: { label: href, href, children: [] },
      pageIndex: resolved.pageIndex,
      spreadIndex: resolved.spreadIndex,
    },
  };
}

function stringProperty(object, key) {
  const value = object[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Reader worker locator is missing ${key}`);
  }
  return value;
}

function jsonMethod(operation, readPayload) {
  return callRitoCoreWasm(operation, () => parseObjectPayload(readPayload(), operation));
}

function encodeJson(value, operation) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    throw new Error(
      `${operation} input is not JSON-serializable: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

function parseObjectPayload(payload, operation) {
  return requireObjectPayload(parseJsonPayload(payload, operation), operation);
}

function parseJsonPayload(payload, operation) {
  let value;
  try {
    value = JSON.parse(payload);
  } catch (error) {
    throw new Error(
      `${operation} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return value;
}

function requireObjectPayload(value, operation) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${operation} returned a non-object JSON payload`);
  }
  return value;
}
