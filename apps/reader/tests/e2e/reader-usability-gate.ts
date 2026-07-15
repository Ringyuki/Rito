import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  readerUsabilityMetrics,
  type ReaderLoadProfileReport,
  type ReaderProfileEnvironment,
  type ReaderProfileViewport,
  type ReaderUsabilityMetrics,
} from './reader-profile-model';
import {
  boundedInteger,
  exactRecord,
  invalid,
  nonEmptyArray,
  nonEmptyText,
  parseJson,
  positiveFinite,
} from './reader-usability-gate-validation';

export const READER_USABILITY_GATE_SCHEMA_VERSION = 1;

export interface ReaderUsabilityGateMachine {
  readonly id: string;
  readonly platform: string;
  readonly arch: string;
  readonly cpuModel: string;
  readonly osRelease: string;
  readonly browserName: string;
  readonly browserVersion: string;
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

const MACHINE_KEYS = [
  'id',
  'platform',
  'arch',
  'cpuModel',
  'osRelease',
  'browserName',
  'browserVersion',
] as const;
const MACHINE_ENVIRONMENT_KEYS = MACHINE_KEYS.slice(1) as readonly Exclude<
  (typeof MACHINE_KEYS)[number],
  'id'
>[];
const VIEWPORT_KEYS = ['width', 'height'] as const;
const THRESHOLD_KEYS = [
  'openRoundTripMs',
  'boundedToPresentationMs',
  'frameWarmRoundTripMs',
  'canvasReadyMs',
  'cachedTurnFirstFrameMs',
  'deferredGrowthFirstFrameMs',
  'reflowFirstFrameMs',
  'maxLongTaskMs',
] as const satisfies readonly (keyof ReaderUsabilityMetrics)[];

export async function loadReaderUsabilityGate(path: string): Promise<ReaderUsabilityGate> {
  const manifestPath = resolve(path);
  const value = parseJson(await readFile(manifestPath, 'utf8'), manifestPath);
  const root = exactRecord(
    value,
    [
      'schemaVersion',
      'machine',
      'deviceScaleFactor',
      'viewport',
      'reflowViewport',
      'runs',
      'cases',
    ],
    'manifest',
  );
  if (root['schemaVersion'] !== READER_USABILITY_GATE_SCHEMA_VERSION) {
    throw invalid('manifest.schemaVersion', 'must equal 1');
  }
  const runs = boundedInteger(root['runs'], 'manifest.runs', 1, 10);
  const rawCases = nonEmptyArray(root['cases'], 'manifest.cases');
  const cases: ReaderUsabilityGateCase[] = [];
  const ids = new Set<string>();
  for (const [index, value] of rawCases.entries()) {
    const parsed = await parseCase(value, dirname(manifestPath), index);
    if (ids.has(parsed.id)) throw invalid('manifest.cases', `duplicate id "${parsed.id}"`);
    ids.add(parsed.id);
    cases.push(parsed);
  }
  return {
    schemaVersion: READER_USABILITY_GATE_SCHEMA_VERSION,
    machine: parseMachine(root['machine']),
    deviceScaleFactor: positiveFinite(root['deviceScaleFactor'], 'manifest.deviceScaleFactor'),
    viewport: parseViewport(root['viewport'], 'manifest.viewport'),
    reflowViewport: parseViewport(root['reflowViewport'], 'manifest.reflowViewport'),
    runs,
    cases,
  };
}

export function requireReaderUsabilityEnvironment(
  gate: ReaderUsabilityGate,
  actualEnvironment: ReaderProfileEnvironment,
  suppliedMachineId: string | undefined,
): ReaderProfileEnvironment {
  const expected = gate.machine;
  const mismatches: string[] = [];
  compare(mismatches, 'supplied machine id', suppliedMachineId, expected.id);
  compare(mismatches, 'profile machine id', actualEnvironment.machineId, expected.id);
  for (const key of MACHINE_ENVIRONMENT_KEYS) {
    compare(mismatches, key, actualEnvironment[key], expected[key]);
  }
  compare(
    mismatches,
    'deviceScaleFactor',
    actualEnvironment.deviceScaleFactor,
    gate.deviceScaleFactor,
  );
  compareViewport(mismatches, 'viewport', actualEnvironment.viewport, gate.viewport);
  compareViewport(
    mismatches,
    'reflowViewport',
    actualEnvironment.reflowViewport,
    gate.reflowViewport,
  );
  if (mismatches.length > 0) {
    throw new Error(`Reader usability environment mismatch:\n${mismatches.join('\n')}`);
  }
  return actualEnvironment;
}

export function evaluateReaderUsabilityCase(
  caseConfig: ReaderUsabilityGateCase,
  reports: readonly ReaderLoadProfileReport[],
  expectedRuns: number,
): ReaderUsabilityCaseSummary {
  boundedInteger(expectedRuns, 'expectedRuns', 1, 10);
  if (reports.length !== expectedRuns) {
    throw new Error(
      `Reader usability case "${caseConfig.id}" expected ${String(expectedRuns)} reports, received ${String(reports.length)}`,
    );
  }
  const firstEnvironment = reports[0]?.environment;
  for (const [index, report] of reports.entries()) {
    if (report.fixture.id !== caseConfig.id || report.fixture.sha256 !== caseConfig.sha256) {
      throw new Error(
        `Reader usability case "${caseConfig.id}" report ${String(index + 1)} fixture identity mismatch`,
      );
    }
    if (firstEnvironment && !sameEnvironment(report.environment, firstEnvironment)) {
      throw new Error(
        `Reader usability case "${caseConfig.id}" report ${String(index + 1)} environment mismatch`,
      );
    }
  }
  const samples = reports.map(readerUsabilityMetrics);
  const p95 = metricMap((key) => nearestRank95(samples.map((sample) => sample[key])));
  const exceeded = THRESHOLD_KEYS.filter((key) => p95[key] > caseConfig.thresholds[key]);
  if (exceeded.length > 0) {
    const details = exceeded.map(
      (key) => `- ${key}: p95 ${String(p95[key])} ms > ${String(caseConfig.thresholds[key])} ms`,
    );
    throw new Error(
      `Reader usability thresholds exceeded for "${caseConfig.id}":\n${details.join('\n')}`,
    );
  }
  return {
    caseId: caseConfig.id,
    fixtureSha256: caseConfig.sha256,
    runs: expectedRuns,
    p95,
    thresholds: { ...caseConfig.thresholds },
  };
}

async function parseCase(
  value: unknown,
  manifestDirectory: string,
  index: number,
): Promise<ReaderUsabilityGateCase> {
  const path = `manifest.cases[${String(index)}]`;
  const record = exactRecord(value, ['id', 'epub', 'sha256', 'thresholds'], path);
  const epub = resolve(manifestDirectory, nonEmptyText(record['epub'], `${path}.epub`));
  const epubStat = await stat(epub).catch(() => undefined);
  if (!epubStat?.isFile()) throw invalid(`${path}.epub`, `must identify a file: ${epub}`);
  const sha256 = nonEmptyText(record['sha256'], `${path}.sha256`);
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw invalid(`${path}.sha256`, 'must be 64 lowercase hexadecimal characters');
  }
  return {
    id: nonEmptyText(record['id'], `${path}.id`),
    epub,
    sha256,
    thresholds: parseThresholds(record['thresholds'], `${path}.thresholds`),
  };
}

function parseMachine(value: unknown): ReaderUsabilityGateMachine {
  const record = exactRecord(value, MACHINE_KEYS, 'manifest.machine');
  return {
    id: nonEmptyText(record['id'], 'manifest.machine.id'),
    platform: nonEmptyText(record['platform'], 'manifest.machine.platform'),
    arch: nonEmptyText(record['arch'], 'manifest.machine.arch'),
    cpuModel: nonEmptyText(record['cpuModel'], 'manifest.machine.cpuModel'),
    osRelease: nonEmptyText(record['osRelease'], 'manifest.machine.osRelease'),
    browserName: nonEmptyText(record['browserName'], 'manifest.machine.browserName'),
    browserVersion: nonEmptyText(record['browserVersion'], 'manifest.machine.browserVersion'),
  };
}

function parseViewport(value: unknown, path: string): ReaderProfileViewport {
  const record = exactRecord(value, VIEWPORT_KEYS, path);
  return {
    width: boundedInteger(record['width'], `${path}.width`, 1),
    height: boundedInteger(record['height'], `${path}.height`, 1),
  };
}

function parseThresholds(value: unknown, path: string): ReaderUsabilityThresholds {
  const record = exactRecord(value, THRESHOLD_KEYS, path);
  return metricMap((key) => positiveFinite(record[key], `${path}.${key}`));
}

function metricMap(value: (key: keyof ReaderUsabilityMetrics) => number): ReaderUsabilityMetrics {
  return {
    openRoundTripMs: value('openRoundTripMs'),
    boundedToPresentationMs: value('boundedToPresentationMs'),
    frameWarmRoundTripMs: value('frameWarmRoundTripMs'),
    canvasReadyMs: value('canvasReadyMs'),
    cachedTurnFirstFrameMs: value('cachedTurnFirstFrameMs'),
    deferredGrowthFirstFrameMs: value('deferredGrowthFirstFrameMs'),
    reflowFirstFrameMs: value('reflowFirstFrameMs'),
    maxLongTaskMs: value('maxLongTaskMs'),
  };
}

function nearestRank95(values: readonly number[]): number {
  for (const value of values) {
    if (!Number.isFinite(value) || value < 0) throw invalid('report metric', 'must be finite');
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
}

function sameEnvironment(left: ReaderProfileEnvironment, right: ReaderProfileEnvironment): boolean {
  return (
    left.machineId === right.machineId &&
    MACHINE_ENVIRONMENT_KEYS.every((key) => left[key] === right[key]) &&
    left.deviceScaleFactor === right.deviceScaleFactor &&
    left.viewport.width === right.viewport.width &&
    left.viewport.height === right.viewport.height &&
    left.reflowViewport.width === right.reflowViewport.width &&
    left.reflowViewport.height === right.reflowViewport.height
  );
}

function compareViewport(
  errors: string[],
  label: string,
  actual: ReaderProfileViewport,
  expected: ReaderProfileViewport,
): void {
  compare(errors, `${label}.width`, actual.width, expected.width);
  compare(errors, `${label}.height`, actual.height, expected.height);
}

function compare(errors: string[], label: string, actual: unknown, expected: unknown): void {
  if (actual !== expected)
    errors.push(
      `- ${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
}
