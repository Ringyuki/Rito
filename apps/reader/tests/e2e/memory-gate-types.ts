export const READER_MEMORY_GATE_SCHEMA_VERSION = 2;

export const READER_MEMORY_METRIC_KEYS = [
  'baselinePhysFootprintMiB',
  'loadedDeltaMiB',
  'checkpointPeakPhysFootprintMiB',
  'replacementGrowthMiB',
  'disposedRetainedMiB',
] as const;

export type ReaderMemoryMetricKey = (typeof READER_MEMORY_METRIC_KEYS)[number];
export type ReaderMemoryMetrics = Readonly<Record<ReaderMemoryMetricKey, number>>;

export interface ReaderMemoryViewport {
  readonly width: number;
  readonly height: number;
}

export interface ReaderMemoryMachine {
  readonly id: string;
  readonly platform: 'darwin';
  readonly arch: string;
  readonly cpuModel: string;
  readonly osRelease: string;
  readonly browserName: 'chromium';
  readonly browserVersion: string;
}

export interface ReaderMemoryBrowserPolicy {
  readonly isolation: 'process-per-run';
  readonly channel: 'bundled';
  readonly headless: true;
  readonly locale: string;
  readonly colorScheme: 'light' | 'dark';
}

export interface ReaderMemoryPinnedFont {
  readonly sha256: string;
  readonly byteLength: number;
  readonly genericRole: string;
  readonly language: string;
}

export interface ReaderMemoryFixture {
  readonly id: string;
  /** Absolute path resolved from the manifest directory. */
  readonly epub: string;
  readonly sha256: string;
}

export interface ReaderMemoryStabilizationPolicy {
  readonly sampleIntervalMs: number;
  readonly minSamples: number;
  readonly maxSamples: number;
  readonly maxSampleRangeMiB: number;
  readonly maxSampleGrowthMiB: number;
}

export interface ReaderMemoryScenario {
  readonly replacementRounds: number;
  readonly stabilization: ReaderMemoryStabilizationPolicy;
}

export type ReaderMemoryThresholds = ReaderMemoryMetrics;

export interface ReaderMemoryGate {
  readonly schemaVersion: typeof READER_MEMORY_GATE_SCHEMA_VERSION;
  readonly machine: ReaderMemoryMachine;
  readonly browser: ReaderMemoryBrowserPolicy;
  readonly pinnedFonts: readonly ReaderMemoryPinnedFont[];
  readonly deviceScaleFactor: number;
  readonly viewport: ReaderMemoryViewport;
  readonly reflowViewport: ReaderMemoryViewport;
  readonly runs: number;
  readonly fixture: ReaderMemoryFixture;
  readonly scenario: ReaderMemoryScenario;
  readonly thresholds: ReaderMemoryThresholds;
}

export interface ReaderMemoryEnvironment {
  readonly machineId: string;
  readonly platform: string;
  readonly arch: string;
  readonly cpuModel: string;
  readonly osRelease: string;
  readonly browserName: string;
  readonly browserVersion: string;
  readonly deviceScaleFactor: number;
  readonly locale: string;
  readonly colorScheme: 'light' | 'dark';
  readonly viewport: ReaderMemoryViewport;
  readonly reflowViewport: ReaderMemoryViewport;
}

export interface ReaderMemoryProcessSample {
  readonly pid: number;
  readonly type: string;
  readonly name: string;
  readonly cpuTimeSeconds: number;
  readonly physFootprintBytes: number;
}

export interface ReaderMemoryDiagnostics {
  /** Informational diagnostics for the page isolate only; never used as gate metrics. */
  readonly pageJsHeapUsedBytes: number;
  readonly pageJsHeapTotalBytes: number;
  readonly pageEmbedderHeapUsedBytes: number | null;
  readonly pageBackingStorageBytes: number | null;
  readonly documents: number;
  readonly nodes: number;
  readonly jsEventListeners: number;
}

export interface ReaderMemorySample {
  readonly capturedAt: string;
  readonly totalPhysFootprintBytes: number;
  readonly processes: readonly ReaderMemoryProcessSample[];
  /** Informational page-isolate diagnostics; never used as a gate metric. */
  readonly diagnostics: ReaderMemoryDiagnostics;
}

export interface ReaderMemoryCheckpoint {
  readonly label: string;
  readonly selected: ReaderMemorySample;
  readonly stableWindow: readonly ReaderMemorySample[];
  readonly samples: readonly ReaderMemorySample[];
  readonly stableRangeBytes: number;
  readonly stableGrowthBytes: number;
}

export interface ReaderMemoryWorkerCreation {
  readonly workerId: number;
  readonly createdAt: number;
}

export interface ReaderMemoryWorkerSessionRelease {
  readonly workerId: number;
  readonly openOrdinal: number;
  readonly openRequestId: number;
  readonly openStartedAt: number;
  readonly openCompletedAt: number;
  readonly openSucceeded: boolean;
  readonly disposeRequestId: number;
  readonly disposeStartedAt: number;
  readonly releasedDocument: boolean;
  readonly disposedAt: number;
}

export interface ReaderMemoryWorkerTermination {
  readonly workerId: number;
  readonly terminatedAt: number;
}

export interface ReaderMemoryWorkerLifecycle {
  readonly createdWorkers: readonly ReaderMemoryWorkerCreation[];
  readonly sessions: readonly ReaderMemoryWorkerSessionRelease[];
  readonly terminations: readonly ReaderMemoryWorkerTermination[];
  readonly liveWorkerIds: readonly number[];
}

export interface ReaderMemoryReportFixture {
  readonly id: string;
  readonly path: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface ReaderMemoryGateReport {
  readonly schemaVersion: typeof READER_MEMORY_GATE_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly environment: ReaderMemoryEnvironment;
  readonly browser: ReaderMemoryBrowserPolicy;
  readonly fixture: ReaderMemoryReportFixture;
  readonly scenario: ReaderMemoryScenario;
  readonly checkpoints: {
    readonly baseline: ReaderMemoryCheckpoint;
    readonly loaded: ReaderMemoryCheckpoint;
    readonly growth: ReaderMemoryCheckpoint;
    readonly reflow: ReaderMemoryCheckpoint;
    readonly replacements: readonly ReaderMemoryCheckpoint[];
    readonly disposed: ReaderMemoryCheckpoint;
  };
  readonly workerLifecycle: ReaderMemoryWorkerLifecycle;
  readonly metrics: ReaderMemoryMetrics;
}

export interface ReaderMemoryGateSummary {
  readonly fixtureId: string;
  readonly fixtureSha256: string;
  readonly runs: number;
  readonly p95: ReaderMemoryMetrics;
  readonly thresholds: ReaderMemoryThresholds;
  readonly runMetrics: readonly ReaderMemoryMetrics[];
}
