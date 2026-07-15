import type { ReaderProfileBrowserPolicy, ReaderProfileViewport } from './reader-profile-model';
import type { ReaderUsabilityMetrics } from './reader-usability-metrics';

export const READER_USABILITY_GATE_SCHEMA_VERSION = 2;

export const READER_USABILITY_MACHINE_KEYS = [
  'id',
  'platform',
  'arch',
  'cpuModel',
  'osRelease',
  'browserName',
  'browserVersion',
] as const;

export const READER_USABILITY_MACHINE_ENVIRONMENT_KEYS = READER_USABILITY_MACHINE_KEYS.slice(
  1,
) as readonly Exclude<(typeof READER_USABILITY_MACHINE_KEYS)[number], 'id'>[];

export interface ReaderUsabilityGateMachine {
  readonly id: string;
  readonly platform: string;
  readonly arch: string;
  readonly cpuModel: string;
  readonly osRelease: string;
  readonly browserName: string;
  readonly browserVersion: string;
}

export interface ReaderUsabilityGateBrowser extends ReaderProfileBrowserPolicy {
  readonly isolation: 'process-per-run';
  readonly channel: 'bundled';
  readonly headless: true;
}

export interface ReaderUsabilityPinnedFont {
  readonly sha256: string;
  readonly byteLength: number;
  readonly genericRole: string;
  readonly language: string;
}

export type ReaderUsabilityThresholds = ReaderUsabilityMetrics;

export interface ReaderUsabilityGateCase {
  readonly id: string;
  /** Absolute path resolved from the manifest directory. */
  readonly epub: string;
  readonly sha256: string;
  readonly thresholds: ReaderUsabilityThresholds;
}

export interface ReaderUsabilityGate {
  readonly schemaVersion: typeof READER_USABILITY_GATE_SCHEMA_VERSION;
  readonly machine: ReaderUsabilityGateMachine;
  readonly browser: ReaderUsabilityGateBrowser;
  readonly pinnedFonts: readonly ReaderUsabilityPinnedFont[];
  readonly deviceScaleFactor: number;
  readonly viewport: ReaderProfileViewport;
  readonly reflowViewport: ReaderProfileViewport;
  readonly runs: number;
  readonly cases: readonly ReaderUsabilityGateCase[];
}

export interface ReaderUsabilityCaseSummary {
  readonly caseId: string;
  readonly fixtureSha256: string;
  readonly runs: number;
  readonly p95: ReaderUsabilityMetrics;
  readonly thresholds: ReaderUsabilityThresholds;
}
