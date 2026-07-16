import {
  READER_MEMORY_GATE_SCHEMA_VERSION,
  READER_MEMORY_METRIC_KEYS,
  type ReaderMemoryBrowserPolicy,
  type ReaderMemoryCheckpoint,
  type ReaderMemoryEnvironment,
  type ReaderMemoryGateReport,
  type ReaderMemoryMetrics,
  type ReaderMemoryReportFixture,
  type ReaderMemoryScenario,
  type ReaderMemoryWorkerLifecycle,
} from './memory-gate-types';

const BYTES_PER_MIB = 1024 * 1024;

export interface ReaderMemoryReportInput {
  readonly generatedAt: string;
  readonly environment: ReaderMemoryEnvironment;
  readonly browser: ReaderMemoryBrowserPolicy;
  readonly fixture: ReaderMemoryReportFixture;
  readonly scenario: ReaderMemoryScenario;
  readonly checkpoints: ReaderMemoryGateReport['checkpoints'];
  readonly workerLifecycle: ReaderMemoryWorkerLifecycle;
}

export function buildReaderMemoryGateReport(
  input: ReaderMemoryReportInput,
): ReaderMemoryGateReport {
  return {
    schemaVersion: READER_MEMORY_GATE_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    environment: input.environment,
    browser: input.browser,
    fixture: input.fixture,
    scenario: input.scenario,
    checkpoints: input.checkpoints,
    workerLifecycle: input.workerLifecycle,
    metrics: measureReaderMemoryMetrics(input.checkpoints),
  };
}

export function measureReaderMemoryMetrics(
  checkpoints: ReaderMemoryGateReport['checkpoints'],
): ReaderMemoryMetrics {
  if (checkpoints.replacements.length === 0) {
    throw new Error('Reader memory report requires at least one replacement checkpoint');
  }
  const baseline = checkpointBytes(checkpoints.baseline);
  const loaded = checkpointBytes(checkpoints.loaded);
  const lastReplacement = checkpointBytes(requireCheckpoint(checkpoints.replacements.at(-1)));
  const disposed = checkpointBytes(checkpoints.disposed);
  const all = [
    checkpoints.baseline,
    checkpoints.loaded,
    checkpoints.growth,
    checkpoints.reflow,
    ...checkpoints.replacements,
    checkpoints.disposed,
  ];
  return metricRecord({
    baselinePhysFootprintMiB: toMiB(baseline),
    loadedDeltaMiB: toMiB(loaded - baseline),
    checkpointPeakPhysFootprintMiB: toMiB(Math.max(...all.map(checkpointPeakBytes))),
    replacementGrowthMiB: toMiB(lastReplacement - checkpointBytes(checkpoints.reflow)),
    disposedRetainedMiB: toMiB(disposed - baseline),
  });
}

function metricRecord(metrics: ReaderMemoryMetrics): ReaderMemoryMetrics {
  return Object.fromEntries(
    READER_MEMORY_METRIC_KEYS.map((key) => [key, rounded(metrics[key])]),
  ) as unknown as ReaderMemoryMetrics;
}

function checkpointBytes(checkpoint: ReaderMemoryCheckpoint): number {
  return checkpoint.selected.totalPhysFootprintBytes;
}

function checkpointPeakBytes(checkpoint: ReaderMemoryCheckpoint): number {
  const peak = Math.max(...checkpoint.samples.map((sample) => sample.totalPhysFootprintBytes));
  if (!Number.isFinite(peak)) {
    throw new Error(`Reader memory checkpoint ${checkpoint.label} has no samples`);
  }
  return peak;
}

function requireCheckpoint(checkpoint: ReaderMemoryCheckpoint | undefined): ReaderMemoryCheckpoint {
  if (!checkpoint) throw new Error('Reader memory replacement checkpoint is unavailable');
  return checkpoint;
}

function toMiB(bytes: number): number {
  return bytes / BYTES_PER_MIB;
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}
