import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmDocumentRuntime } from '../dist/core-wasm-document-runtime.js';
import { createRitoCoreWasmWorkerReaderClient } from '../dist/reader-worker-client-runtime.js';

const { RitoCoreWasmDocument } = createRitoCoreWasmDocumentRuntime(
  async () => {},
  unusedRawDocument,
);

test('shape diagnostic rejects a forged versioned handle', () => {
  const document = diagnosticDocument(shapeDiagnostic(), handle(2));
  assert.throws(
    () => document.getShapeProvenanceDiagnosticAtRevision(handle(1)),
    /mismatched revision handle/,
  );
});

test('shape diagnostic rejects malformed coverage and frequency semantics', () => {
  for (const value of malformedDiagnostics()) {
    const document = diagnosticDocument(value);
    assert.throws(() => document.getShapeProvenanceDiagnosticAtRevision(handle(1)));
  }
});

test('shape diagnostic accepts exact top-N truncation and valid mixed frequencies', () => {
  const validDiagnostics = [
    shapeDiagnosticWithAffectedCodepoints(257),
    exactMixedShapeDiagnostic({ '0000000000000000': 1, 1111111111111111: 1 }),
  ];
  for (const value of validDiagnostics) {
    const document = diagnosticDocument(value);
    assert.doesNotThrow(() => document.getShapeProvenanceDiagnosticAtRevision(handle(1)));
  }
});

test('worker client applies the same shape diagnostic validator', async () => {
  const worker = new ManualWorker();
  const client = await openClient(worker);
  let pending = client.getShapeProvenanceDiagnosticAtRevision(handle(1));
  worker.respondLast({
    kind: 'getShapeProvenanceDiagnosticAtRevision',
    revision: handle(2),
    result: shapeDiagnostic(),
  });
  await assert.rejects(pending, /mismatched revision handle/);

  pending = client.getShapeProvenanceDiagnosticAtRevision(handle(1));
  worker.respondLast({
    kind: 'getShapeProvenanceDiagnosticAtRevision',
    revision: handle(1),
    result: { ...shapeDiagnostic(), exactTextRuns: 1 },
  });
  await assert.rejects(pending, /inconsistent exact\/unavailable run counts/);
  client.dispose();
});

function malformedDiagnostics() {
  return [
    { ...shapeDiagnostic(), schemaVersion: 2 },
    { ...shapeDiagnostic(), isComplete: 'complete' },
    { ...shapeDiagnostic(), totalTextRuns: 2 },
    { ...shapeDiagnostic(), totalTextUtf16CodeUnitCount: 2 },
    { ...shapeDiagnostic(), unavailableReasonCounts: { unknownReason: 1 } },
    {
      ...shapeDiagnostic(),
      unavailableReasonUtf16CodeUnitCounts: { unknownReason: 1 },
    },
    {
      ...shapeDiagnostic(),
      unavailableReasonUtf16CodeUnitCounts: { hostMetricsFallback: 2 },
    },
    { ...shapeDiagnostic(), unavailableAffectedCodepointDistinctCount: 2 },
    withAffectedCodepoint('U+D800', 'hostMetricsFallback'),
    withAffectedCodepoint('U+0041', 'syntheticLayoutText'),
    {
      ...shapeDiagnosticWithAffectedCodepoints(2),
      unavailableAffectedCodepoints: affectedCodepoints(1),
      unavailableAffectedCodepointOmittedCount: 1,
    },
    shapeDiagnosticWithAffectedCodepoints(257, 256),
    {
      ...exactSingleShapeDiagnostic(),
      unavailableAffectedCodepointOccurrenceCount: 1,
      unavailableAffectedCodepointDistinctCount: 1,
      unavailableAffectedCodepointOmittedCount: 1,
    },
    exactMixedShapeDiagnostic({ '0000000000000000': 2 }),
    {
      ...exactSingleShapeDiagnostic(),
      singleFontFingerprints: { '000000000000000G': 1 },
    },
  ];
}

function diagnosticDocument(value, revision = handle(1)) {
  return new RitoCoreWasmDocument({
    getShapeProvenanceDiagnosticAtRevisionJson: () => JSON.stringify({ revision, value }),
  });
}

function withAffectedCodepoint(codepoint, reason) {
  return {
    ...shapeDiagnostic(),
    unavailableAffectedCodepoints: [{ codepoint, count: 1, reasonCounts: { [reason]: 1 } }],
  };
}

function shapeDiagnostic() {
  return {
    schemaVersion: 1,
    isComplete: true,
    knownPageCount: 1,
    totalTextRuns: 1,
    exactTextRuns: 0,
    unavailableTextRuns: 1,
    totalTextUtf16CodeUnitCount: 1,
    exactTextUtf16CodeUnitCount: 0,
    unavailableTextUtf16CodeUnitCount: 1,
    excludedRubyTextRunCount: 0,
    excludedRubyTextUtf16CodeUnitCount: 0,
    singleFontTextRuns: 0,
    mixedFontTextRuns: 0,
    unavailableReasonCounts: { hostMetricsFallback: 1 },
    unavailableReasonUtf16CodeUnitCounts: { hostMetricsFallback: 1 },
    singleFontFingerprints: {},
    mixedFontFingerprints: {},
    unavailableAffectedCodepoints: [
      { codepoint: 'U+0041', count: 1, reasonCounts: { hostMetricsFallback: 1 } },
    ],
    unavailableAffectedCodepointOccurrenceCount: 1,
    unavailableAffectedCodepointDistinctCount: 1,
    unavailableAffectedCodepointOmittedCount: 0,
  };
}

function exactSingleShapeDiagnostic() {
  return {
    ...shapeDiagnostic(),
    exactTextRuns: 1,
    unavailableTextRuns: 0,
    exactTextUtf16CodeUnitCount: 1,
    unavailableTextUtf16CodeUnitCount: 0,
    singleFontTextRuns: 1,
    unavailableReasonCounts: {},
    unavailableReasonUtf16CodeUnitCounts: {},
    singleFontFingerprints: { '0000000000000000': 1 },
    unavailableAffectedCodepoints: [],
    unavailableAffectedCodepointOccurrenceCount: 0,
    unavailableAffectedCodepointDistinctCount: 0,
    unavailableAffectedCodepointOmittedCount: 0,
  };
}

function exactMixedShapeDiagnostic(fingerprints) {
  return {
    ...exactSingleShapeDiagnostic(),
    singleFontTextRuns: 0,
    mixedFontTextRuns: 1,
    singleFontFingerprints: {},
    mixedFontFingerprints: fingerprints,
  };
}

function shapeDiagnosticWithAffectedCodepoints(distinctCount, occurrenceCount = distinctCount) {
  return {
    ...shapeDiagnostic(),
    totalTextUtf16CodeUnitCount: occurrenceCount,
    unavailableTextUtf16CodeUnitCount: occurrenceCount,
    unavailableReasonUtf16CodeUnitCounts: { hostMetricsFallback: occurrenceCount },
    unavailableAffectedCodepoints: affectedCodepoints(Math.min(distinctCount, 256)),
    unavailableAffectedCodepointOccurrenceCount: occurrenceCount,
    unavailableAffectedCodepointDistinctCount: distinctCount,
    unavailableAffectedCodepointOmittedCount: Math.max(distinctCount - 256, 0),
  };
}

function affectedCodepoints(count) {
  return Array.from({ length: count }, (_, index) => ({
    codepoint: `U+${(0x1000 + index).toString(16).toUpperCase().padStart(4, '0')}`,
    count: 1,
    reasonCounts: { hostMetricsFallback: 1 },
  }));
}

async function openClient(worker) {
  const client = createRitoCoreWasmWorkerReaderClient(worker);
  const opening = client.open(new ArrayBuffer(0));
  await Promise.resolve();
  worker.respondLast({ kind: 'open', result: { publication: { title: 'fixture' } } });
  await opening;
  return client;
}

function handle(revisionVersion) {
  return { revisionId: 'rev-1', revisionVersion };
}

function unusedRawDocument() {
  throw new Error('fixture constructs the wrapped document directly');
}

class ManualWorker {
  listeners = new Map();
  messages = [];

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  postMessage(message) {
    this.messages.push(message);
  }

  terminate() {}

  respondLast(payload) {
    const { id } = this.messages.at(-1);
    this.emit('message', { data: { id, ok: true, payload } });
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
