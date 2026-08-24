import type {
  ReaderMemoryCheckpoint,
  ReaderMemoryEnvironment,
  ReaderMemoryGate,
  ReaderMemoryGateReport,
  ReaderMemoryMetrics,
  ReaderMemorySample,
} from './memory-gate-types';
import { READER_MEMORY_METRIC_KEYS } from './memory-gate-types';
import { buildReaderMemoryGateReport } from './memory-gate-report';

const BYTES_PER_MIB = 1024 * 1024;

export const MEMORY_GATE_TEST_SHA256 = 'a'.repeat(64);
export const MEMORY_GATE_TEST_ENVIRONMENT: ReaderMemoryEnvironment = {
  machineId: 'test-mac',
  platform: 'darwin',
  arch: 'arm64',
  cpuModel: 'Apple Test',
  osRelease: '25.5.0',
  browserName: 'chromium',
  browserVersion: '147.0.0.0',
  deviceScaleFactor: 1,
  locale: 'en-US',
  colorScheme: 'light',
  viewport: { width: 1280, height: 720 },
  reflowViewport: { width: 1120, height: 720 },
};

export function memoryGateTestManifest(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    machine: {
      id: 'test-mac',
      platform: 'darwin',
      arch: 'arm64',
      cpuModel: 'Apple Test',
      osRelease: '25.5.0',
      browserName: 'chromium',
      browserVersion: '147.0.0.0',
    },
    browser: {
      isolation: 'process-per-run',
      channel: 'bundled',
      headless: true,
      locale: 'en-US',
      colorScheme: 'light',
    },
    pinnedFonts: [
      {
        sha256: 'b'.repeat(64),
        byteLength: 1024,
        genericRole: 'serif',
        language: 'und',
      },
    ],
    deviceScaleFactor: 1,
    viewport: { width: 1280, height: 720 },
    reflowViewport: { width: 1120, height: 720 },
    runs: 3,
    fixture: { id: 'fixture', epub: './fixture.epub', sha256: MEMORY_GATE_TEST_SHA256 },
    scenario: {
      replacementRounds: 3,
      stabilization: {
        sampleIntervalMs: 250,
        minSamples: 3,
        maxSamples: 6,
        maxSampleRangeMiB: 8,
        maxSampleGrowthMiB: 2,
      },
    },
    thresholds: memoryGateTestMetrics(256),
  };
}

export function memoryGateTestReport(
  gate: ReaderMemoryGate,
  footprintOffsetMiB = 0,
): ReaderMemoryGateReport {
  const baseline = memoryGateTestCheckpoint('app-ready', 100 + footprintOffsetMiB);
  const loaded = memoryGateTestCheckpoint('loaded', 110 + footprintOffsetMiB);
  const growth = memoryGateTestCheckpoint('growth', 115 + footprintOffsetMiB);
  const reflow = memoryGateTestCheckpoint('reflow', 120 + footprintOffsetMiB);
  const replacements = [
    memoryGateTestCheckpoint('replacement-1', 120 + footprintOffsetMiB),
    memoryGateTestCheckpoint('replacement-2', 121 + footprintOffsetMiB),
    memoryGateTestCheckpoint('replacement-3', 122 + footprintOffsetMiB),
  ];
  const disposed = memoryGateTestCheckpoint('disposed', 105 + footprintOffsetMiB);
  return buildReaderMemoryGateReport({
    generatedAt: '2026-07-16T00:00:00.000Z',
    environment: MEMORY_GATE_TEST_ENVIRONMENT,
    browser: gate.browser,
    fixture: {
      id: gate.fixture.id,
      path: gate.fixture.epub,
      byteLength: 4,
      sha256: gate.fixture.sha256,
    },
    scenario: gate.scenario,
    checkpoints: { baseline, loaded, growth, reflow, replacements, disposed },
    workerLifecycle: {
      createdWorkers: [{ workerId: 1, createdAt: 1 }],
      sessions: memoryGateTestSessions(gate.scenario.replacementRounds + 2),
      terminations: [{ workerId: 1, terminatedAt: 100 }],
      liveWorkerIds: [],
    },
  });
}

function memoryGateTestSessions(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const openStartedAt = 2 + index * 10;
    return {
      workerId: 1,
      openOrdinal: index + 1,
      openRequestId: index * 2 + 1,
      openStartedAt,
      openCompletedAt: openStartedAt + 1,
      openSucceeded: true,
      disposeRequestId: index * 2 + 2,
      disposeStartedAt: openStartedAt + 2,
      releasedDocument: true,
      wasmMemoryByteLength: null,
      disposedAt: openStartedAt + 3,
    };
  });
}

export function memoryGateTestMetrics(value: number): ReaderMemoryMetrics {
  return Object.fromEntries(
    READER_MEMORY_METRIC_KEYS.map((key) => [key, value]),
  ) as unknown as ReaderMemoryMetrics;
}

export function memoryGateTestCheckpoint(label: string, totalMiB: number): ReaderMemoryCheckpoint {
  const sample = memoryGateTestSample(totalMiB);
  return {
    label,
    selected: sample,
    stableWindow: [sample, sample, sample],
    samples: [sample, sample, sample],
    stableRangeBytes: 0,
    stableGrowthBytes: 0,
  };
}

export function memoryGateTestSample(totalMiB: number): ReaderMemorySample {
  const totalPhysFootprintBytes = totalMiB * BYTES_PER_MIB;
  return {
    capturedAt: '2026-07-16T00:00:00.000Z',
    totalPhysFootprintBytes,
    processes: [
      {
        pid: 42,
        type: 'browser',
        name: 'Chromium',
        cpuTimeSeconds: 1,
        physFootprintBytes: totalPhysFootprintBytes,
      },
    ],
    diagnostics: {
      pageJsHeapUsedBytes: 10,
      pageJsHeapTotalBytes: 20,
      pageEmbedderHeapUsedBytes: 30,
      pageBackingStorageBytes: 40,
      documents: 1,
      nodes: 2,
      jsEventListeners: 3,
    },
  };
}
