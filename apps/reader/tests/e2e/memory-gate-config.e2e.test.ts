import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { evaluateReaderMemoryGate, requireReaderMemoryEnvironment } from './memory-gate-evaluator';
import { loadReaderMemoryGate } from './memory-gate-parser';
import { measureReaderMemoryMetrics } from './memory-gate-report';
import {
  MEMORY_GATE_TEST_ENVIRONMENT as ENVIRONMENT,
  memoryGateTestCheckpoint as checkpoint,
  memoryGateTestManifest as validManifest,
  memoryGateTestReport as report,
  memoryGateTestSample as sample,
} from './memory-gate-test-data';
import { READER_MEMORY_METRIC_KEYS, type ReaderMemoryMetrics } from './memory-gate-types';
import { parseMacOSFootprint, parseReaderCdpProcesses } from './memory-process-parser';
import { findStableMemoryWindow, requireStableReaderProcessSet } from './memory-sampler';
import {
  observedLiveWorkerIdsFromSnapshot,
  requireReaderSessionReleaseFromSnapshot,
  requireReaderSessionReleasesFromSnapshot,
} from './memory-worker-lifecycle';
import type { ReaderWorkerOperationObservation } from './reader-worker-probe';

let directory = '';

test.beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'rito-memory-gate-'));
  await writeFile(join(directory, 'fixture.epub'), 'epub');
});

test.afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

test('strictly parses the named-machine manifest and resolves its fixture', async () => {
  const gate = await loadReaderMemoryGate(await writeManifest(validManifest()));
  expect(gate.schemaVersion).toBe(2);
  expect(gate.runs).toBe(3);
  expect(gate.browser.isolation).toBe('process-per-run');
  expect(gate.fixture.epub).toBe(resolve(directory, 'fixture.epub'));
  expect(gate.scenario.stabilization.minSamples).toBe(3);
  expect(gate.scenario.stabilization.maxSampleGrowthMiB).toBe(2);
});

test('rejects missing and unknown fields at every manifest layer', async () => {
  const mutations: readonly ((manifest: Record<string, unknown>) => void)[] = [
    (manifest) => delete manifest['runs'],
    (manifest) => (manifest['extra'] = true),
    (manifest) => delete record(manifest['machine'])['arch'],
    (manifest) => (record(manifest['machine'])['extra'] = true),
    (manifest) => delete record(manifest['browser'])['locale'],
    (manifest) => (record(manifest['browser'])['extra'] = true),
    (manifest) => delete record(first(manifest['pinnedFonts']))['byteLength'],
    (manifest) => (record(first(manifest['pinnedFonts']))['extra'] = true),
    (manifest) => delete record(manifest['fixture'])['sha256'],
    (manifest) => (record(manifest['scenario'])['extra'] = true),
    (manifest) => delete record(record(manifest['scenario'])['stabilization'])['minSamples'],
    (manifest) => (record(record(manifest['scenario'])['stabilization'])['gcPassesPerSample'] = 2),
    (manifest) =>
      delete record(record(manifest['scenario'])['stabilization'])['maxSampleGrowthMiB'],
    (manifest) => delete record(manifest['thresholds'])['disposedRetainedMiB'],
    (manifest) => (record(manifest['thresholds'])['extra'] = true),
  ];
  for (const [index, mutate] of mutations.entries()) {
    const manifest = validManifest();
    mutate(manifest);
    await expect(loadReaderMemoryGate(await writeManifest(manifest, index))).rejects.toThrow(
      /Invalid reader memory gate/,
    );
  }
});

test('rejects non-calibration run counts and invalid scenario bounds', async () => {
  for (const [index, mutate] of [
    (manifest: Record<string, unknown>) => (manifest['runs'] = 2),
    (manifest: Record<string, unknown>) => (manifest['runs'] = 6),
    (manifest: Record<string, unknown>) =>
      (record(record(manifest['scenario'])['stabilization'])['maxSamples'] = 2),
    (manifest: Record<string, unknown>) =>
      (record(record(manifest['scenario'])['stabilization'])['maxSampleGrowthMiB'] = -1),
    (manifest: Record<string, unknown>) => (record(manifest['reflowViewport'])['width'] = 1280),
  ].entries()) {
    const manifest = validManifest();
    mutate(manifest);
    await expect(loadReaderMemoryGate(await writeManifest(manifest, index))).rejects.toThrow();
  }
});

test('strictly joins CDP process identity to auxiliary phys_footprint', () => {
  const processes = parseReaderCdpProcesses({
    processInfo: [
      { type: 'browser', id: 12, cpuTime: 1.5 },
      { type: 'renderer', id: 13, cpuTime: 2.5 },
    ],
  });
  const parsed = parseMacOSFootprint(
    JSON.stringify({
      unit: 'byte',
      'bytes per unit': 1,
      processes: [
        { name: 'Chromium', pid: 12, footprint: 999, auxiliary: { phys_footprint: 100 } },
        { name: 'Renderer', pid: 13, footprint: 999, auxiliary: { phys_footprint: 200 } },
      ],
      errors: [],
      warnings: [],
    }),
    processes,
  );
  expect(parsed.map((entry) => entry.physFootprintBytes)).toEqual([100, 200]);
  expect(parsed.map((entry) => entry.type)).toEqual(['browser', 'renderer']);
});

test('rejects footprint diagnostics, PID drift, duplicates, and non-byte units', () => {
  const processes = parseReaderCdpProcesses({
    processInfo: [{ type: 'browser', id: 12, cpuTime: 1 }],
  });
  const footprint = (overrides: Record<string, unknown>) =>
    JSON.stringify({
      unit: 'byte',
      'bytes per unit': 1,
      processes: [{ name: 'Chromium', pid: 12, auxiliary: { phys_footprint: 100 } }],
      errors: [],
      warnings: [],
      ...overrides,
    });
  expect(() => parseMacOSFootprint(footprint({ unit: 'MiB' }), processes)).toThrow();
  expect(() => parseMacOSFootprint(footprint({ errors: ['denied'] }), processes)).toThrow();
  expect(() => parseMacOSFootprint(footprint({ warnings: ['partial'] }), processes)).toThrow();
  expect(() => parseMacOSFootprint(footprint({ processes: [] }), processes)).toThrow(/missing/);
  expect(() =>
    parseMacOSFootprint(
      footprint({
        processes: [
          { name: 'Chromium', pid: 12, auxiliary: { phys_footprint: 100 } },
          { name: 'Chromium', pid: 12, auxiliary: { phys_footprint: 100 } },
        ],
      }),
      processes,
    ),
  ).toThrow(/duplicate/);
});

test('rejects a Chromium PID set that changes during footprint capture', () => {
  const before = parseReaderCdpProcesses({
    processInfo: [
      { type: 'browser', id: 12, cpuTime: 1 },
      { type: 'renderer', id: 13, cpuTime: 1 },
    ],
  });
  const same = parseReaderCdpProcesses({
    processInfo: [
      { type: 'renderer', id: 13, cpuTime: 2 },
      { type: 'browser', id: 12, cpuTime: 2 },
    ],
  });
  const drifted = parseReaderCdpProcesses({
    processInfo: [
      { type: 'browser', id: 12, cpuTime: 2 },
      { type: 'renderer', id: 14, cpuTime: 0 },
    ],
  });
  expect(() => {
    requireStableReaderProcessSet(before, same);
  }).not.toThrow();
  expect(() => {
    requireStableReaderProcessSet(before, drifted);
  }).toThrow(/process set changed/);
});

test('tracks reused physical workers as ordered logical open sessions', () => {
  const creations = [
    { workerId: 1, createdAt: 1 },
    { workerId: 2, createdAt: 2 },
  ];
  const termination = { workerId: 1, terminatedAt: 30 };
  expect(observedLiveWorkerIdsFromSnapshot(creations, [termination])).toEqual([2]);

  const operations = reusedWorkerOperations();
  const releases = requireReaderSessionReleasesFromSnapshot(operations);
  expect(releases).toHaveLength(2);
  expect(releases.map((entry) => entry.openSucceeded)).toEqual([true, false]);
  expect(requireReaderSessionReleaseFromSnapshot(operations, requireEntry(releases, 0))).toEqual({
    workerId: 1,
    openOrdinal: 1,
    openRequestId: 1,
    openStartedAt: 2,
    openCompletedAt: 3,
    openSucceeded: true,
    disposeRequestId: 2,
    disposeStartedAt: 4,
    releasedDocument: true,
    disposedAt: 5,
  });
});

test('rejects overlap and missing release in a reused worker session sequence', () => {
  const operations = reusedWorkerOperations();
  expect(() => {
    requireReaderSessionReleasesFromSnapshot([
      requireEntry(operations, 0),
      requireEntry(operations, 1),
      { ...requireEntry(operations, 2), startedAt: 4.5 },
      requireEntry(operations, 3),
    ]);
  }).toThrow(/before the previous dispose acknowledgement/);
  expect(() => requireReaderSessionReleasesFromSnapshot(operations.slice(0, 3))).toThrow(
    /has no dispose acknowledgement/,
  );
  expect(() =>
    requireReaderSessionReleasesFromSnapshot([
      requireEntry(operations, 0),
      { ...requireEntry(operations, 1), releasedDocument: false },
    ]),
  ).toThrow(/did not release its opened document/);
});

test('selects only a stable physical-footprint window', () => {
  const policy = {
    sampleIntervalMs: 250,
    minSamples: 3,
    maxSamples: 6,
    maxSampleRangeMiB: 10,
    maxSampleGrowthMiB: 2,
  };
  expect(findStableMemoryWindow([sample(100), sample(104), sample(108)], policy)).toBeNull();
  expect(
    findStableMemoryWindow([sample(90), sample(100), sample(101), sample(102)], policy),
  ).toEqual([sample(100), sample(101), sample(102)]);
});

test('derives footprint metrics without gating renderer diagnostics', () => {
  const growth = checkpoint('growth', 125);
  const metrics = measureReaderMemoryMetrics({
    baseline: checkpoint('baseline', 100),
    loaded: checkpoint('loaded', 120),
    growth: { ...growth, samples: [sample(125), sample(140), sample(125)] },
    reflow: checkpoint('reflow', 130),
    replacements: [checkpoint('replacement-1', 128), checkpoint('replacement-2', 131)],
    disposed: checkpoint('disposed', 106),
  });
  expect(metrics).toEqual({
    baselinePhysFootprintMiB: 100,
    loadedDeltaMiB: 20,
    checkpointPeakPhysFootprintMiB: 140,
    replacementGrowthMiB: 1,
    disposedRetainedMiB: 6,
  });
});

test('uses nearest-rank p95 and reports every exceeded footprint threshold', async () => {
  const gate = await loadReaderMemoryGate(await writeManifest(validManifest()));
  const reports = [report(gate, 1), report(gate, 7), report(gate, 3)];
  const passing = { ...gate, thresholds: metricRecord(256) };
  expect(evaluateReaderMemoryGate(passing, reports).p95).toEqual({
    baselinePhysFootprintMiB: 107,
    loadedDeltaMiB: 10,
    checkpointPeakPhysFootprintMiB: 129,
    replacementGrowthMiB: 2,
    disposedRetainedMiB: 5,
  });
  let failure: unknown;
  try {
    evaluateReaderMemoryGate({ ...gate, thresholds: metricRecord(0.5) }, reports);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  for (const key of READER_MEMORY_METRIC_KEYS) {
    expect((failure as Error).message).toContain(key);
  }
});

test('recomputes metrics and rejects incomplete scenario evidence', async () => {
  const gate = await loadReaderMemoryGate(await writeManifest(validManifest()));
  const oneRunGate = { ...gate, runs: 1 };
  const valid = report(gate);
  expect(() =>
    evaluateReaderMemoryGate(oneRunGate, [{ ...valid, metrics: metricRecord(0) }]),
  ).toThrow(/metrics do not match/);
  expect(() =>
    evaluateReaderMemoryGate(oneRunGate, [
      {
        ...valid,
        checkpoints: {
          ...valid.checkpoints,
          replacements: valid.checkpoints.replacements.slice(0, 2),
        },
      },
    ]),
  ).toThrow(/replacement checkpoint count/);
  expect(() =>
    evaluateReaderMemoryGate(oneRunGate, [
      {
        ...valid,
        workerLifecycle: {
          ...valid.workerLifecycle,
          sessions: valid.workerLifecycle.sessions.slice(0, -1),
        },
      },
    ]),
  ).toThrow(/successful sessions/);
});

test('rejects environment, fixture, run-count, and live-worker drift', async () => {
  const gate = await loadReaderMemoryGate(await writeManifest(validManifest()));
  expect(() => {
    requireReaderMemoryEnvironment(gate, ENVIRONMENT);
  }).not.toThrow();
  expect(() => {
    requireReaderMemoryEnvironment(gate, { ...ENVIRONMENT, browserVersion: 'other' });
  }).toThrow(/browserVersion/);
  expect(() => {
    requireReaderMemoryEnvironment(gate, { ...ENVIRONMENT, locale: 'zh-CN' });
  }).toThrow(/locale/);
  expect(() => evaluateReaderMemoryGate(gate, [report(gate)])).toThrow(/expected 3 reports/);

  const oneRunGate = { ...gate, runs: 1 };
  const fixtureDrift = {
    ...report(gate),
    fixture: { ...report(gate).fixture, sha256: 'c'.repeat(64) },
  };
  expect(() => evaluateReaderMemoryGate(oneRunGate, [fixtureDrift])).toThrow(/fixture identity/);

  const liveWorker = {
    ...report(gate),
    workerLifecycle: { ...report(gate).workerLifecycle, liveWorkerIds: [9] },
  };
  expect(() => evaluateReaderMemoryGate(oneRunGate, [liveWorker])).toThrow(/live workers/);

  const missingPhysicalTermination = {
    ...report(gate),
    workerLifecycle: {
      ...report(gate).workerLifecycle,
      terminations: [],
    },
  };
  expect(() => evaluateReaderMemoryGate(oneRunGate, [missingPhysicalTermination])).toThrow(
    /incomplete terminated workers/,
  );
});

async function writeManifest(manifest: Record<string, unknown>, suffix = 0): Promise<string> {
  const path = join(directory, `gate-${String(suffix)}.json`);
  await writeFile(path, JSON.stringify(manifest));
  return path;
}

function metricRecord(value: number): ReaderMemoryMetrics {
  return Object.fromEntries(
    READER_MEMORY_METRIC_KEYS.map((key) => [key, value]),
  ) as unknown as ReaderMemoryMetrics;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('test value is not a record');
  }
  return value as Record<string, unknown>;
}

function first(value: unknown): unknown {
  if (!Array.isArray(value) || value.length === 0) throw new Error('test array is empty');
  return value[0];
}

function workerOperation(
  overrides: Partial<ReaderWorkerOperationObservation> = {},
): ReaderWorkerOperationObservation {
  return {
    workerId: 1,
    requestId: 1,
    kind: 'open',
    startedAt: 2,
    requestBytes: null,
    maxTopLevelNodes: null,
    maxQuanta: null,
    processedTopLevelNodes: null,
    advancedQuanta: null,
    spreadIndex: null,
    completedAt: 3,
    durationMs: 1,
    ok: true,
    responseKind: 'open',
    releasedDocument: null,
    wasmMemoryByteLength: null,
    requestedRevision: null,
    revision: null,
    chapterLocalRevision: null,
    error: null,
    ...overrides,
  };
}

function reusedWorkerOperations(): ReaderWorkerOperationObservation[] {
  return [
    workerOperation(),
    workerOperation({
      requestId: 2,
      kind: 'dispose',
      startedAt: 4,
      completedAt: 5,
      responseKind: 'dispose',
      releasedDocument: true,
    }),
    workerOperation({
      requestId: 3,
      kind: 'open',
      startedAt: 6,
      completedAt: 7,
      ok: false,
      responseKind: null,
      error: 'invalid epub',
    }),
    workerOperation({
      requestId: 4,
      kind: 'dispose',
      startedAt: 8,
      completedAt: 9,
      responseKind: 'dispose',
      releasedDocument: false,
    }),
  ];
}

function requireEntry<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`missing test entry ${String(index)}`);
  return value;
}
