import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmDocumentRuntime } from '../dist/core-wasm-document-runtime.js';
import { normalizeRitoCoreWasmError } from '../dist/core-wasm-error-runtime.js';
import { createRitoCoreWasmReaderWorkerHandler } from '../dist/reader-worker-client-runtime.js';

const RUNTIME_BUNDLE_HEADER_BYTES = 56;
const VIEW_REQUEST = { mode: 'full', layoutConfig: { pageWidth: 320, pageHeight: 480 } };
const VIEW_RESPONSE = {
  kind: 'full',
  display: 'canonical',
  result: {
    bundle: { revision: { revisionId: 'revision-1' } },
    preview: false,
  },
};
const PUBLIC_WORKER_PAYLOAD = {
  kind: 'createViewRevision',
  result: {
    kind: 'full',
    display: 'canonical',
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
    assert.deepEqual(response.payload, PUBLIC_WORKER_PAYLOAD);
    assert.equal(Object.hasOwn(response, '__ritoWireMetrics'), false);
    assert.doesNotMatch(JSON.stringify(response.payload), /__ritoWireMetrics/);
    assert.equal(runtime.state.measureCalls, 0);
    assert.equal(runtime.state.takeCalls, 0);
  });

  test(`${wire} worker requests report complete private wire metrics`, async () => {
    const runtime = await openWorkerRuntime(wire);
    const response = await runtime.scope.send(createViewRevisionRequest(wire, true));

    assert.equal(response.ok, true);
    assert.deepEqual(response.payload, PUBLIC_WORKER_PAYLOAD);
    assert.doesNotMatch(JSON.stringify(response.payload), /__ritoWireMetrics/);
    assert.equal(runtime.state.measureCalls, 1);
    assert.equal(runtime.state.takeCalls, 1);
    assert.deepEqual(
      runtime.state.requests.map((value) => JSON.parse(value)),
      [VIEW_REQUEST],
    );
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
    createViewRevisionBundleJson: (requestJson) => rawViewPayload(state, requestJson, jsonPayload),
    createViewRevisionBundleBytes: (requestJson) =>
      rawViewPayload(state, requestJson, binaryPayload),
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

function rawViewPayload(state, requestJson, payload) {
  state.requests.push(requestJson);
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
    'canonical',
    'result',
    'bundle',
    'revision',
    'revisionId',
    'revision-1',
    'preview',
  ];
  const values = [
    stringRecord(1),
    stringRecord(3),
    stringRecord(8),
    objectRecord([[7, 2]]),
    objectRecord([[6, 3]]),
    new Uint8Array([1]),
    objectRecord([
      [5, 4],
      [9, 5],
    ]),
    objectRecord([
      [0, 0],
      [2, 1],
      [4, 6],
    ]),
  ];
  return runtimeBundleBytes(strings, values, 7);
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
