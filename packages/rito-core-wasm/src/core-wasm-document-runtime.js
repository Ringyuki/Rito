import { callRitoCoreWasm } from './core-wasm-error-runtime.js';
import { decodeRitoRuntimeBundle } from './runtime-bundle-decoder-runtime.js';

export function createRitoCoreWasmDocumentRuntime(initRitoCoreWasm, RawRitoWasmDocument) {
  async function initRitoCoreWasmEngine(initInput) {
    try {
      await initRitoCoreWasm(initInput);
    } catch (error) {
      throw callRitoCoreWasm('initRitoCoreWasmEngine', () => {
        throw error;
      });
    }
    return {
      openDocument(bytes) {
        return callRitoCoreWasm(
          'openDocument',
          () => new RitoCoreWasmDocument(new RawRitoWasmDocument(bytes)),
        );
      },
    };
  }

  class RitoCoreWasmDocument {
    constructor(inner) {
      this._inner = inner;
    }

    free() {
      return callRitoCoreWasm('free', () => this._inner.free());
    }

    publication() {
      return callRitoCoreWasm('publication', () =>
        parseObjectPayload(this._inner.publicationJson(), 'publication'),
      );
    }

    createFullRevisionBundle(request) {
      return jsonMethod('createFullRevisionBundle', () =>
        this._inner.createFullRevisionBundleJson(encodeJson(request, 'createFullRevisionBundle')),
      );
    }

    createInitialPreviewRevisionBundle(request) {
      return jsonMethod('createInitialPreviewRevisionBundle', () =>
        this._inner.createInitialPreviewRevisionBundleJson(
          encodeJson(request, 'createInitialPreviewRevisionBundle'),
        ),
      );
    }

    createActiveChapterPreviewRevisionBundle(request) {
      return callRitoCoreWasm('createActiveChapterPreviewRevisionBundle', () => {
        const payload = this._inner.createActiveChapterPreviewRevisionBundleJson(
          encodeJson(request, 'createActiveChapterPreviewRevisionBundle'),
        );
        if (payload === 'null') return undefined;
        return parseObjectPayload(payload, 'createActiveChapterPreviewRevisionBundle');
      });
    }

    createPreviewRevisionBundle(request) {
      return callRitoCoreWasm('createPreviewRevisionBundle', () => {
        const payload = this._inner.createPreviewRevisionBundleJson(
          encodeJson(request, 'createPreviewRevisionBundle'),
        );
        if (payload === 'null') return undefined;
        return parseObjectPayload(payload, 'createPreviewRevisionBundle');
      });
    }

    createViewRevisionBundle(request) {
      return callRitoCoreWasm('createViewRevisionBundle', () =>
        decodeJsonViewRevisionBundle(
          this._inner.createViewRevisionBundleJson(encodeJson(request, 'createViewRevisionBundle')),
          'createViewRevisionBundle',
        ),
      );
    }

    createViewRevisionBundleBytes(request) {
      return callRitoCoreWasm('createViewRevisionBundleBytes', () =>
        decodeBinaryViewRevisionBundle(
          this._inner.createViewRevisionBundleBytes(
            encodeJson(request, 'createViewRevisionBundleBytes'),
          ),
          'createViewRevisionBundleBytes',
        ),
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

    readerWorkerPayload(request) {
      return callRitoCoreWasm('readerWorkerPayload', () => readerWorkerPayload(this, request));
    }

    readResourceTransfer(transferId) {
      return callRitoCoreWasm('readResourceTransfer', () =>
        this._inner.readResourceTransfer(transferId),
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

  return { initRitoCoreWasmEngine, RitoCoreWasmDocument };
}

function readerWorkerPayload(document, request) {
  switch (request.kind) {
    case 'createViewRevision':
      return createReaderViewRevision(
        document,
        request.request,
        request.wire,
        request.__ritoCollectWireMetrics === true,
        request.knownFullChapterTextIndicesScopeKey,
      );
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
    default:
      throw new Error(`Unsupported reader worker request: ${String(request.kind)}`);
  }
}

function createReaderViewRevision(document, request, wire, collectWireMetrics, knownScopeKey) {
  const omitFullIndices = knownScopeKey === 'chapter-text-v1:full';
  const measured = collectWireMetrics
    ? createMeasuredReaderViewRevisionBundle(document, request, wire, omitFullIndices)
    : undefined;
  const view =
    measured?.view ??
    createUnmeasuredReaderViewRevisionBundle(document, request, wire, omitFullIndices);
  return {
    kind: 'createViewRevision',
    ...(measured !== undefined ? { __ritoWireMetrics: measured.metrics } : {}),
    result: {
      kind: view.kind,
      display: view.display,
      ...(view.followUp !== undefined ? { followUp: view.followUp } : {}),
      result: revisionResult(document, view.result),
    },
  };
}

function createMeasuredReaderViewRevisionBundle(document, request, wire, omitFullIndices) {
  const selectedWire = wire === 'ritorb1' ? 'ritorb1' : 'json';
  const operation =
    selectedWire === 'ritorb1'
      ? 'createReaderViewRevisionBundleBytes'
      : 'createReaderViewRevisionBundleJson';
  return callRitoCoreWasm(operation, () =>
    createMeasuredViewRevisionBundle(
      document._inner,
      request,
      selectedWire,
      operation,
      omitFullIndices,
    ),
  );
}

function createUnmeasuredReaderViewRevisionBundle(document, request, wire, omitFullIndices) {
  const operation =
    wire === 'ritorb1'
      ? 'createReaderViewRevisionBundleBytes'
      : 'createReaderViewRevisionBundleJson';
  return callRitoCoreWasm(operation, () => {
    const requestJson = encodeJson(request, operation);
    const rawPayload =
      wire === 'ritorb1'
        ? document._inner.createReaderViewRevisionBundleBytes(requestJson, omitFullIndices)
        : document._inner.createReaderViewRevisionBundleJson(requestJson, omitFullIndices);
    return decodeReaderViewRevision(rawPayload, wire, operation);
  });
}

function createMeasuredViewRevisionBundle(inner, request, wire, operation, omitFullIndices) {
  const requestJson = encodeJson(request, operation);
  requireWireMetricsMethods(inner);
  inner.measureNextViewRevisionWire();
  const wasmStartedAt = monotonicNow();
  const rawPayload =
    wire === 'ritorb1'
      ? inner.createReaderViewRevisionBundleBytes(requestJson, omitFullIndices)
      : inner.createReaderViewRevisionBundleJson(requestJson, omitFullIndices);
  const wasmMethodMs = elapsedMilliseconds(wasmStartedAt);
  const rustMetrics = takeViewRevisionWireMetrics(inner, wire);
  const decoded = decodeMeasuredViewRevision(rawPayload, wire, operation);
  return {
    view: decoded.view,
    metrics: {
      ...rustMetrics,
      wasmMethodMs,
      jsDecodeMs: decoded.jsDecodeMs,
    },
  };
}

function requireWireMetricsMethods(inner) {
  if (
    typeof inner.measureNextViewRevisionWire !== 'function' ||
    typeof inner.takeViewRevisionWireMetricsJson !== 'function'
  ) {
    throw new Error('Rito core WASM binding does not support view-revision wire metrics');
  }
}

function takeViewRevisionWireMetrics(inner, expectedWire) {
  const value = parseJsonPayload(
    inner.takeViewRevisionWireMetricsJson(),
    'takeViewRevisionWireMetrics',
  );
  if (value === null) {
    throw new Error('View-revision wire metrics were not recorded after measurement was armed');
  }
  const metrics = requireObjectPayload(value, 'takeViewRevisionWireMetrics');
  if (metrics.wire !== expectedWire) {
    throw new Error(`View-revision wire metrics reported unexpected wire: ${String(metrics.wire)}`);
  }
  requireNonNegativeInteger(metrics.rawWireBytes, 'rawWireBytes');
  requireNonNegativeNumber(metrics.rustEncodeMs, 'rustEncodeMs');
  return {
    wire: metrics.wire,
    rawWireBytes: metrics.rawWireBytes,
    rustEncodeMs: metrics.rustEncodeMs,
  };
}

function decodeMeasuredViewRevision(rawPayload, wire, operation) {
  const decodeStartedAt = monotonicNow();
  const view = decodeReaderViewRevision(rawPayload, wire, operation);
  const jsDecodeMs = elapsedMilliseconds(decodeStartedAt);
  return { view, jsDecodeMs };
}

function decodeReaderViewRevision(rawPayload, wire, operation) {
  return wire === 'ritorb1'
    ? decodeBinaryViewRevisionBundle(rawPayload, operation)
    : decodeJsonViewRevisionBundle(rawPayload, operation);
}

function decodeBinaryViewRevisionBundle(rawPayload, operation) {
  return requireViewRevisionPayload(decodeRitoRuntimeBundle(rawPayload).payload, operation);
}

function decodeJsonViewRevisionBundle(rawPayload, operation) {
  return requireViewRevisionPayload(parseJsonPayload(rawPayload, operation), operation);
}

function requireViewRevisionPayload(value, operation) {
  const view = requireObjectPayload(value, operation);
  if (view.kind !== 'preview' && view.kind !== 'full') {
    throw new Error(`${operation} returned an invalid view revision kind`);
  }
  if (view.display !== 'revision' && view.display !== 'visualPreview') {
    throw new Error(`${operation} returned an invalid view revision display`);
  }
  const result = requireObjectPayload(view.result, `${operation} result`);
  const bundle = requireObjectPayload(result.bundle, `${operation} result bundle`);
  const revision = requireObjectPayload(bundle.revision, `${operation} bundle revision`);
  if (typeof revision.revisionId !== 'string' || revision.revisionId.length === 0) {
    throw new Error(`${operation} returned a view revision without a revisionId`);
  }
  if (typeof result.preview !== 'boolean') {
    throw new Error(`${operation} returned a view revision without a preview flag`);
  }
  requireViewRevisionFollowUp(view.followUp, operation);
  return view;
}

function requireViewRevisionFollowUp(value, operation) {
  if (value === undefined) return;
  const followUp = requireObjectPayload(value, `${operation} follow-up`);
  if (
    followUp.mode !== 'full' ||
    !Number.isSafeInteger(followUp.delayMs) ||
    followUp.delayMs < 0 ||
    typeof followUp.previousRevisionId !== 'string' ||
    followUp.previousRevisionId.length === 0
  ) {
    throw new Error(`${operation} returned an invalid view revision follow-up`);
  }
}

function requireNonNegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`View-revision wire metrics ${field} must be a non-negative integer`);
  }
}

function requireNonNegativeNumber(value, field) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`View-revision wire metrics ${field} must be a non-negative finite number`);
  }
}

function monotonicNow() {
  return globalThis.performance.now();
}

function elapsedMilliseconds(startedAt) {
  const elapsed = monotonicNow() - startedAt;
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0;
}

function revisionResult(document, result) {
  return {
    bundle: result.bundle,
    ...(result.frameSelection !== undefined ? { frameSelection: result.frameSelection } : {}),
    ...selectedFrameWindowResult(
      document,
      result.bundle.revision.revisionId,
      result.frameSelection,
      result.initialFrameWindow,
    ),
    preview: result.preview,
  };
}

function selectedFrameWindowResult(document, revisionId, frameSelection, frameWindow) {
  if (frameWindow === undefined || frameSelection === undefined) return {};
  if (frameWindow.plan.revisionId !== revisionId) throw new Error('frame window revision mismatch');
  const warmed = frameWindowResult(document, frameWindow);
  const frame = warmed.frames.find(
    (frame) => frame.metadata.spreadIndex === frameSelection.spreadIndex,
  );
  if (!frame) {
    throw new Error('planned frame window missing selected frame');
  }
  return {
    frameWindow: warmed,
    selectedFrame: {
      spreadIndex: frameSelection.spreadIndex,
      displaySpreadIndex: frameSelection.displaySpreadIndex,
      frame,
    },
  };
}

function warmReaderFrameWindow(document, revisionId, spreadIndex) {
  const prefetched = document.prefetchPlannedFrameResources(revisionId, spreadIndex);
  return { kind: 'warmFrameWindow', result: frameWindowResult(document, prefetched) };
}

function frameWindowResult(document, prefetched) {
  return {
    plan: prefetched.plan,
    frames: prefetched.plan.spreadIndexes.map((spreadIndex) =>
      readFrameBuffer(document, prefetched.plan.revisionId, spreadIndex),
    ),
    spreads: prefetched.spreads.map((spread) => ({
      spreadIndex: spread.spreadIndex,
      resources: readResourcePayloadBytes(document, spread.payloads),
    })),
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
  try {
    return {
      kind: 'readResource',
      result: { payload, bytes: document.readResourceTransfer(payload.transferId) },
    };
  } finally {
    document.releaseResourceTransfer(payload.transferId);
  }
}

function readResourcePayloadBytes(document, payloads) {
  const resources = [];
  for (const payload of payloads) {
    try {
      resources.push({ payload, bytes: document.readResourceTransfer(payload.transferId) });
    } catch {
      // Frame resource warmup is opportunistic. Missing bytes should not fail callers.
    } finally {
      document.releaseResourceTransfer(payload.transferId);
    }
  }
  return resources;
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
