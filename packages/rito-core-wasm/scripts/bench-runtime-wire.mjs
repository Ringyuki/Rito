import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';

const entryUrl = new URL('../dist/index.mjs', import.meta.url);
const wasmUrl = new URL('../dist/rito_wasm_bg.wasm', import.meta.url);
const epubUrl = new URL(
  '../../../packages/rito/tests/fixtures/books/book-01.epub',
  import.meta.url,
);
let benchmarkSink = 0;

if (!existsSync(entryUrl) || !existsSync(wasmUrl)) {
  throw new Error('WASM dist files are missing. Run `pnpm run build` first.');
}

const config = {
  sampleCount: readPositiveInteger('RITO_WIRE_BENCH_SAMPLES', 20),
  targetMeasuredMs: readPositiveInteger('RITO_WIRE_BENCH_TARGET_MS', 6_000),
  warmupMs: readNonNegativeInteger('RITO_WIRE_BENCH_WARMUP_MS', 1_000),
  requestedBatchIterations: readOptionalPositiveInteger('RITO_WIRE_BENCH_BATCH'),
};
const { decodeRitoRuntimeBundle, initRitoCoreWasmEngine } = await import(entryUrl.href);
const engine = await initRitoCoreWasmEngine({ module_or_path: await readFile(wasmUrl) });
const epubBytes = await readFile(epubUrl);
const requestJson = JSON.stringify(viewRevisionRequest());
const { jsonWire, ritorb1Wire } = createWirePayloads(engine, epubBytes, requestJson);
const jsonPayload = JSON.parse(jsonWire);
const ritorb1Payload = decodeRitoRuntimeBundle(ritorb1Wire).payload;

assert.deepStrictEqual(ritorb1Payload, jsonPayload, 'RITORB1 must decode to the JSON payload');
assertBenchmarkPayload(jsonPayload);

const warmupBatchCount = warmUp(jsonWire, ritorb1Wire, config.warmupMs);
const calibration = calibrateBatchIterations(
  jsonWire,
  ritorb1Wire,
  config.targetMeasuredMs,
  config.sampleCount,
  config.requestedBatchIterations,
);
const measurements = measureAlternatingBatches(
  jsonWire,
  ritorb1Wire,
  calibration.batchIterations,
  config.sampleCount,
);
const jsonTiming = summarizeTimings(measurements.jsonElapsedMs, calibration.batchIterations);
const ritorb1Timing = summarizeTimings(measurements.ritorb1ElapsedMs, calibration.batchIterations);
const pairedRatios = jsonTiming.samplesMsPerDecode.map(
  (jsonMs, index) => ritorb1Timing.samplesMsPerDecode[index] / jsonMs,
);

process.stdout.write(
  `${JSON.stringify(
    {
      benchmark: 'runtime-wire-decode',
      fixture: 'packages/rito/tests/fixtures/books/book-01.epub',
      machine: machineInfo(),
      runtime: {
        node: process.version,
        v8: process.versions.v8,
      },
      payloads: {
        jsonBytes: Buffer.byteLength(jsonWire, 'utf8'),
        ritorb1Bytes: ritorb1Wire.byteLength,
        ritorb1ToJsonByteRatio: round(ritorb1Wire.byteLength / Buffer.byteLength(jsonWire, 'utf8')),
      },
      config: {
        sampleCount: config.sampleCount,
        warmupMs: config.warmupMs,
        warmupBatchCount,
        targetMeasuredMs: config.targetMeasuredMs,
        batchIterations: calibration.batchIterations,
        batchSource: calibration.source,
        alternatingOrder: 'even batches JSON first; odd batches RITORB1 first',
      },
      timings: {
        unit: 'milliseconds',
        measuredWallMs: round(measurements.measuredWallMs),
        json: jsonTiming,
        ritorb1: ritorb1Timing,
        ritorb1ToJsonRatio: {
          samples: pairedRatios.map(round),
          median: round(median(pairedRatios)),
          p95: round(percentile(pairedRatios, 0.95)),
        },
      },
      sink: benchmarkSink,
    },
    null,
    2,
  )}\n`,
);

function createWirePayloads(engine, bytes, request) {
  const jsonDocument = engine.openDocument(new Uint8Array(bytes));
  const ritorb1Document = engine.openDocument(new Uint8Array(bytes));
  try {
    // The public wrappers decode eagerly; this private benchmark needs the raw
    // payloads so layout and encoding happen once, outside the timed batches.
    const jsonWire = jsonDocument._inner.createViewRevisionBundleJson(request);
    const rawRitorb1Wire = ritorb1Document._inner.createViewRevisionBundleBytes(request);
    if (typeof jsonWire !== 'string' || !(rawRitorb1Wire instanceof Uint8Array)) {
      throw new Error('Raw WASM view-revision methods returned unexpected wire payloads.');
    }
    const ritorb1Wire = new Uint8Array(rawRitorb1Wire);
    return { jsonWire, ritorb1Wire };
  } finally {
    jsonDocument.free();
    ritorb1Document.free();
  }
}

function warmUp(jsonWire, ritorb1Wire, durationMs) {
  if (durationMs === 0) return 0;
  const deadline = performance.now() + durationMs;
  let batchCount = 0;
  do {
    if (batchCount % 2 === 0) {
      measureJsonBatch(jsonWire, 1);
      measureRitorb1Batch(ritorb1Wire, 1);
    } else {
      measureRitorb1Batch(ritorb1Wire, 1);
      measureJsonBatch(jsonWire, 1);
    }
    batchCount += 1;
  } while (performance.now() < deadline);
  return batchCount;
}

function calibrateBatchIterations(jsonWire, ritorb1Wire, targetMs, sampleCount, requested) {
  if (requested !== undefined) {
    return { batchIterations: requested, source: 'RITO_WIRE_BENCH_BATCH' };
  }
  let probeIterations = 1;
  let pairElapsedMs =
    measureJsonBatch(jsonWire, probeIterations) + measureRitorb1Batch(ritorb1Wire, probeIterations);
  while (pairElapsedMs < 100 && probeIterations < 4_096) {
    probeIterations *= 2;
    pairElapsedMs =
      measureJsonBatch(jsonWire, probeIterations) +
      measureRitorb1Batch(ritorb1Wire, probeIterations);
  }
  const estimatedPairMs = Math.max(pairElapsedMs / probeIterations, 0.001);
  const batchIterations = Math.max(1, Math.round(targetMs / sampleCount / estimatedPairMs));
  return { batchIterations, source: 'target duration calibration' };
}

function measureAlternatingBatches(jsonWire, ritorb1Wire, iterations, sampleCount) {
  const jsonElapsedMs = [];
  const ritorb1ElapsedMs = [];
  const startedAt = performance.now();
  for (let index = 0; index < sampleCount; index += 1) {
    if (index % 2 === 0) {
      jsonElapsedMs.push(measureJsonBatch(jsonWire, iterations));
      ritorb1ElapsedMs.push(measureRitorb1Batch(ritorb1Wire, iterations));
    } else {
      ritorb1ElapsedMs.push(measureRitorb1Batch(ritorb1Wire, iterations));
      jsonElapsedMs.push(measureJsonBatch(jsonWire, iterations));
    }
  }
  return { jsonElapsedMs, ritorb1ElapsedMs, measuredWallMs: performance.now() - startedAt };
}

function measureJsonBatch(wire, iterations) {
  const startedAt = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    consumePayload(JSON.parse(wire));
  }
  return performance.now() - startedAt;
}

function measureRitorb1Batch(wire, iterations) {
  const startedAt = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    consumePayload(decodeRitoRuntimeBundle(wire).payload);
  }
  return performance.now() - startedAt;
}

function consumePayload(payload) {
  benchmarkSink = (Math.imul(benchmarkSink, 33) + payload.result.bundle.revision.pageCount) >>> 0;
}

function summarizeTimings(elapsedSamples, batchIterations) {
  const samplesMsPerDecode = elapsedSamples.map((elapsed) => elapsed / batchIterations);
  return {
    batchElapsedMsSamples: elapsedSamples.map(round),
    samplesMsPerDecode: samplesMsPerDecode.map(round),
    medianMsPerDecode: round(median(samplesMsPerDecode)),
    p95MsPerDecode: round(percentile(samplesMsPerDecode, 0.95)),
  };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function round(value) {
  return Number(value.toFixed(6));
}

function machineInfo() {
  const cpu = cpus()[0];
  return {
    platform: platform(),
    release: release(),
    architecture: arch(),
    cpuModel: cpu?.model ?? 'unknown',
    logicalCpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
  };
}

function assertBenchmarkPayload(payload) {
  if (!Number.isInteger(payload?.result?.bundle?.revision?.pageCount)) {
    throw new Error('Expected view-revision benchmark payload to include a page count.');
  }
}

function readPositiveInteger(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function readNonNegativeInteger(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
}

function readOptionalPositiveInteger(name) {
  const value = process.env[name];
  return value === undefined ? undefined : readPositiveInteger(name, 1);
}

function viewRevisionRequest() {
  return {
    layoutConfig: {
      firstPageAlone: true,
      marginBottom: 24,
      marginLeft: 24,
      marginRight: 24,
      marginTop: 24,
      pageHeight: 640,
      pageWidth: 420,
      rootFontSize: 16,
      spreadGap: 0,
      spreadMode: 'single',
      viewportHeight: 640,
      viewportWidth: 420,
    },
    lineBreaking: 'greedy',
    activeSpreadIndex: 0,
    mode: 'full',
  };
}
