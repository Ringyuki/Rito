import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmDocumentRuntime } from '../dist/core-wasm-document-runtime.js';
import { normalizeRitoCoreWasmError } from '../dist/core-wasm-error-runtime.js';
import { createRitoCoreWasmReaderWorkerHandler } from '../dist/reader-worker-client-runtime.js';

const RUNTIME_BUNDLE_HEADER_BYTES = 56;
const VIEW_REQUEST = {
  mode: 'full',
  layoutConfig: { pageWidth: 320, pageHeight: 480 },
  activeSpreadIndex: 0,
};
const VIEW_RESPONSE = {
  kind: 'full',
  display: 'revision',
  result: {
    bundle: {
      revision: { revisionId: 'revision-1' },
      chapterTextIndices: {
        revisionId: 'revision-1',
        entries: {},
        scopeKey: 'chapter-text-v1:full',
      },
    },
    preview: false,
    releasedPreviousRevisionTransferCount: 0,
  },
};
const PREVIEW_VIEW_RESPONSE = {
  ...VIEW_RESPONSE,
  kind: 'preview',
  display: 'visualPreview',
  followUp: {
    delayMs: 1_000,
    request: {
      ...VIEW_REQUEST,
      lineBreaking: 'optimal',
      activeSpreadIndex: 2,
      previousRevisionId: 'revision-previous',
    },
  },
  result: { ...VIEW_RESPONSE.result, preview: true },
};
const TRANSPORT_WORKER_PAYLOAD = {
  kind: 'createViewRevision',
  result: {
    kind: 'full',
    display: 'revision',
    result: {
      bundle: VIEW_RESPONSE.result.bundle,
      preview: false,
    },
  },
};

const { RitoCoreWasmDocument } = createRitoCoreWasmDocumentRuntime(
  async () => {},
  unusedRawDocument,
);

function unusedRawDocument() {
  throw new Error('fixture constructs the wrapped document directly');
}

for (const wire of ['json', 'ritorb1']) {
  test(`${wire} worker requests do not collect wire metrics without the private marker`, async () => {
    const runtime = await openWorkerRuntime(wire);
    const response = await runtime.scope.send(createViewRevisionRequest(wire, false));

    assert.equal(response.ok, true);
    assert.deepEqual(response.payload, TRANSPORT_WORKER_PAYLOAD);
    assert.equal(Object.hasOwn(response, '__ritoWireMetrics'), false);
    assert.doesNotMatch(JSON.stringify(response.payload), /__ritoWireMetrics/);
    assert.equal(runtime.state.measureCalls, 0);
    assert.equal(runtime.state.takeCalls, 0);
  });

  test(`${wire} worker requests report complete private wire metrics`, async () => {
    const runtime = await openWorkerRuntime(wire);
    const response = await runtime.scope.send(createViewRevisionRequest(wire, true));

    assert.equal(response.ok, true);
    assert.deepEqual(response.payload, TRANSPORT_WORKER_PAYLOAD);
    assert.doesNotMatch(JSON.stringify(response.payload), /__ritoWireMetrics/);
    assert.equal(runtime.state.measureCalls, 1);
    assert.equal(runtime.state.takeCalls, 1);
    assert.deepEqual(
      runtime.state.requests.map(({ requestJson, omitFullIndices }) => ({
        request: JSON.parse(requestJson),
        omitFullIndices,
      })),
      [{ request: VIEW_REQUEST, omitFullIndices: false }],
    );
    assert.deepEqual(runtime.state.methods, [
      wire === 'ritorb1'
        ? 'createReaderViewRevisionBundleBytes'
        : 'createReaderViewRevisionBundleJson',
    ]);
    assertCompleteMetrics(response.__ritoWireMetrics, wire, runtime.state.rawWireBytes);
  });
}

test('worker rejects invalid Rust wire metrics instead of publishing diagnostics', async () => {
  const runtime = await openWorkerRuntime('json', {
    wire: 'json',
    rawWireBytes: -1,
    rustEncodeMs: 0.25,
  });
  const response = await runtime.scope.send(createViewRevisionRequest('json', true));

  assert.equal(response.ok, false);
  assert.match(response.error.message, /rawWireBytes must be a non-negative integer/);
  assert.equal(Object.hasOwn(response, '__ritoWireMetrics'), false);
});

test('view revision binary adapter rejects a generic scalar bundle payload', () => {
  const document = new RitoCoreWasmDocument({
    createViewRevisionBundleBytes: () => runtimeBundleBytes([], [new Uint8Array([2])], 0),
  });

  assert.throws(() => document.createViewRevisionBundleBytes(VIEW_REQUEST), {
    message: /createViewRevisionBundleBytes returned a non-object JSON payload/,
  });
});

test('view revision JSON adapter rejects invalid discriminants', () => {
  const document = new RitoCoreWasmDocument({
    createViewRevisionBundleJson: () => JSON.stringify({ ...VIEW_RESPONSE, display: 'canonical' }),
  });

  assert.throws(() => document.createViewRevisionBundle(VIEW_REQUEST), {
    message: /createViewRevisionBundle returned an invalid view revision display/,
  });
});

for (const lineBreaking of [undefined, 'greedy', 'optimal']) {
  test(`view revision JSON adapter accepts a preview follow-up with ${lineBreaking ?? 'default'} line breaking`, () => {
    const response = previewResponseWithLineBreaking(lineBreaking);
    const document = new RitoCoreWasmDocument({
      createViewRevisionBundleJson: () => JSON.stringify(response),
    });

    assert.deepEqual(document.createViewRevisionBundle(VIEW_REQUEST), response);
  });
}

function previewResponseWithLineBreaking(lineBreaking) {
  const request = { ...PREVIEW_VIEW_RESPONSE.followUp.request };
  if (lineBreaking === undefined) delete request.lineBreaking;
  else request.lineBreaking = lineBreaking;
  return {
    ...PREVIEW_VIEW_RESPONSE,
    followUp: { ...PREVIEW_VIEW_RESPONSE.followUp, request },
  };
}

const INVALID_FOLLOW_UPS = [
  ['negative delay', { ...PREVIEW_VIEW_RESPONSE.followUp, delayMs: -1 }],
  ['missing request', { delayMs: 1_000 }],
  ['preview mode', followUpWithRequest({ mode: 'preview' })],
  ['non-object layout', followUpWithRequest({ layoutConfig: [] })],
  ['unknown line breaking', followUpWithRequest({ lineBreaking: 'balanced' })],
  ['negative active spread', followUpWithRequest({ activeSpreadIndex: -1 })],
  ['unsafe active spread', followUpWithRequest({ activeSpreadIndex: Number.MAX_SAFE_INTEGER + 1 })],
  ['empty previous revision', followUpWithRequest({ previousRevisionId: '' })],
];

for (const [name, followUp] of INVALID_FOLLOW_UPS) {
  test(`view revision JSON adapter rejects a follow-up with ${name}`, () => {
    const document = new RitoCoreWasmDocument({
      createViewRevisionBundleJson: () =>
        JSON.stringify({
          ...PREVIEW_VIEW_RESPONSE,
          followUp,
        }),
    });

    assert.throws(() => document.createViewRevisionBundle(VIEW_REQUEST), {
      message:
        /createViewRevisionBundle (?:follow-up.*non-object|returned an invalid view revision follow-up)/,
    });
  });
}

function followUpWithRequest(requestOverrides) {
  return {
    ...PREVIEW_VIEW_RESPONSE.followUp,
    request: {
      ...PREVIEW_VIEW_RESPONSE.followUp.request,
      ...requestOverrides,
    },
  };
}

function createViewRevisionRequest(wire, collectWireMetrics) {
  return {
    id: 2,
    kind: 'createViewRevision',
    request: VIEW_REQUEST,
    wire,
    ...(collectWireMetrics ? { __ritoCollectWireMetrics: true } : {}),
  };
}

async function openWorkerRuntime(wire, metricsOverride) {
  const state = createRawDocumentState(wire, metricsOverride);
  const document = new RitoCoreWasmDocument(createRawDocument(state));
  const scope = new TestWorkerScope();
  createRitoCoreWasmReaderWorkerHandler(scope, {
    initRitoCoreWasmEngine: async () => ({ openDocument: () => document }),
    normalizeRitoCoreWasmError,
  });
  const response = await scope.send({ id: 1, kind: 'open', data: new ArrayBuffer(0) });
  assert.deepEqual(response, {
    id: 1,
    ok: true,
    payload: { kind: 'open', result: { publication: { title: 'Fixture' } } },
  });
  return { scope, state };
}

function createRawDocumentState(wire, metricsOverride) {
  return {
    armed: false,
    measureCalls: 0,
    takeCalls: 0,
    requests: [],
    methods: [],
    rawWireBytes: wire === 'json' ? 98_765 : 87_654,
    rustMetrics: metricsOverride,
    wire,
  };
}

function createRawDocument(state) {
  const jsonPayload = JSON.stringify(VIEW_RESPONSE);
  const binaryPayload = viewRevisionBundleBytes();
  return {
    publicationJson: () => JSON.stringify({ title: 'Fixture' }),
    createReaderViewRevisionBundleJson: (requestJson, omitFullIndices) =>
      rawViewPayload(
        state,
        'createReaderViewRevisionBundleJson',
        requestJson,
        omitFullIndices,
        jsonPayload,
      ),
    createReaderViewRevisionBundleBytes: (requestJson, omitFullIndices) =>
      rawViewPayload(
        state,
        'createReaderViewRevisionBundleBytes',
        requestJson,
        omitFullIndices,
        binaryPayload,
      ),
    measureNextViewRevisionWire: () => {
      state.measureCalls += 1;
      state.armed = true;
    },
    takeViewRevisionWireMetricsJson: () => {
      state.takeCalls += 1;
      const metrics = state.rustMetrics;
      state.rustMetrics = null;
      return JSON.stringify(metrics);
    },
  };
}

function rawViewPayload(state, method, requestJson, omitFullIndices, payload) {
  state.methods.push(method);
  state.requests.push({ requestJson, omitFullIndices });
  if (state.armed) {
    state.rustMetrics ??= {
      wire: state.wire,
      rawWireBytes: state.rawWireBytes,
      rustEncodeMs: 0.25,
    };
    state.armed = false;
  }
  return payload;
}

function assertCompleteMetrics(metrics, wire, rawWireBytes) {
  assert.deepEqual(Object.keys(metrics).sort(), [
    'jsDecodeMs',
    'rawWireBytes',
    'rustEncodeMs',
    'wasmMethodMs',
    'wire',
    'workerProcessingMs',
  ]);
  assert.equal(metrics.wire, wire);
  assert.equal(metrics.rawWireBytes, rawWireBytes);
  for (const field of ['rustEncodeMs', 'wasmMethodMs', 'jsDecodeMs', 'workerProcessingMs']) {
    assert.equal(Number.isFinite(metrics[field]), true, `${field} should be finite`);
    assert.ok(metrics[field] >= 0, `${field} should be non-negative`);
  }
}

class TestWorkerScope {
  listener;
  pending = [];

  addEventListener(type, listener) {
    assert.equal(type, 'message');
    this.listener = listener;
  }

  postMessage(message) {
    const resolve = this.pending.shift();
    assert.ok(resolve, 'unexpected worker response');
    resolve(message);
  }

  send(message) {
    assert.ok(this.listener, 'worker message listener is not installed');
    return new Promise((resolve) => {
      this.pending.push(resolve);
      this.listener({ data: message });
    });
  }
}

function viewRevisionBundleBytes() {
  const strings = [
    'kind',
    'full',
    'display',
    'revision',
    'result',
    'bundle',
    'revision',
    'revisionId',
    'revision-1',
    'preview',
    'chapterTextIndices',
    'entries',
    'scopeKey',
    'chapter-text-v1:full',
    'releasedPreviousRevisionTransferCount',
  ];
  const values = [
    stringRecord(1),
    stringRecord(3),
    stringRecord(8),
    objectRecord([[7, 2]]),
    objectRecord([]),
    stringRecord(13),
    objectRecord([
      [7, 2],
      [11, 4],
      [12, 5],
    ]),
    objectRecord([
      [6, 3],
      [10, 6],
    ]),
    new Uint8Array([1]),
    u64Record(0),
    objectRecord([
      [5, 7],
      [9, 8],
      [14, 9],
    ]),
    objectRecord([
      [0, 0],
      [2, 1],
      [4, 10],
    ]),
  ];
  return runtimeBundleBytes(strings, values, 11);
}

function runtimeBundleBytes(strings, values, rootIndex) {
  const stringBytes = joinBytes(
    strings.flatMap((value) => {
      const utf8 = new TextEncoder().encode(value);
      return [u32Bytes(utf8.byteLength), utf8];
    }),
  );
  const valueBytes = joinBytes(values);
  const bytes = new Uint8Array(
    RUNTIME_BUNDLE_HEADER_BYTES + stringBytes.byteLength + valueBytes.byteLength,
  );
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('RITORB1'), 0);
  view.setUint32(8, 1, true);
  view.setUint32(12, RUNTIME_BUNDLE_HEADER_BYTES, true);
  view.setUint32(16, bytes.byteLength, true);
  view.setUint32(20, strings.length, true);
  view.setUint32(24, values.length, true);
  view.setUint32(28, RUNTIME_BUNDLE_HEADER_BYTES, true);
  view.setUint32(32, stringBytes.byteLength, true);
  view.setUint32(36, RUNTIME_BUNDLE_HEADER_BYTES + stringBytes.byteLength, true);
  view.setUint32(40, valueBytes.byteLength, true);
  view.setUint32(44, rootIndex, true);
  bytes.set(stringBytes, RUNTIME_BUNDLE_HEADER_BYTES);
  bytes.set(valueBytes, RUNTIME_BUNDLE_HEADER_BYTES + stringBytes.byteLength);
  const checksum = runtimeBundleChecksum(bytes.subarray(RUNTIME_BUNDLE_HEADER_BYTES));
  view.setUint32(48, Number(checksum & 0xffffffffn), true);
  view.setUint32(52, Number(checksum >> 32n), true);
  return bytes;
}

function stringRecord(index) {
  return joinBytes([new Uint8Array([6]), u32Bytes(index)]);
}

function u64Record(value) {
  const bytes = new Uint8Array(9);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, 4);
  view.setBigUint64(1, BigInt(value), true);
  return bytes;
}

function objectRecord(entries) {
  return joinBytes([
    new Uint8Array([8]),
    u32Bytes(entries.length),
    ...entries.flatMap(([keyIndex, valueIndex]) => [u32Bytes(keyIndex), u32Bytes(valueIndex)]),
  ]);
}

function u32Bytes(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function joinBytes(chunks) {
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function runtimeBundleChecksum(bytes) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash;
}
