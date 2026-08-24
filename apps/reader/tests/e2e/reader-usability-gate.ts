import type {
  ReaderLoadProfileReport,
  ReaderProfileBrowserPolicy,
  ReaderProfileEnvironment,
  ReaderProfileViewport,
} from './reader-profile-model';
import {
  mapReaderUsabilityMetrics,
  readerUsabilityMetrics,
  READER_USABILITY_METRIC_KEYS,
  type ReaderUsabilityMetrics,
} from './reader-usability-metrics';
import {
  READER_USABILITY_MACHINE_ENVIRONMENT_KEYS,
  type ReaderUsabilityCaseSummary,
  type ReaderUsabilityGate,
  type ReaderUsabilityGateCase,
} from './reader-usability-gate-types';
import { boundedInteger, invalid } from './reader-usability-gate-validation';

export { loadReaderUsabilityGate } from './reader-usability-gate-parser';
export {
  READER_USABILITY_GATE_SCHEMA_VERSION,
  type ReaderUsabilityCaseSummary,
  type ReaderUsabilityGate,
  type ReaderUsabilityGateBrowser,
  type ReaderUsabilityGateCase,
  type ReaderUsabilityGateMachine,
  type ReaderUsabilityPinnedFont,
  type ReaderUsabilityThresholds,
} from './reader-usability-gate-types';

export function requireReaderUsabilityEnvironment(
  gate: ReaderUsabilityGate,
  actual: ReaderProfileEnvironment,
  suppliedMachineId: string | undefined,
): ReaderProfileEnvironment {
  const expected = gate.machine;
  const mismatches: string[] = [];
  compare(mismatches, 'supplied machine id', suppliedMachineId, expected.id);
  compare(mismatches, 'profile machine id', actual.machineId, expected.id);
  for (const key of READER_USABILITY_MACHINE_ENVIRONMENT_KEYS) {
    compare(mismatches, key, actual[key], expected[key]);
  }
  compare(mismatches, 'deviceScaleFactor', actual.deviceScaleFactor, gate.deviceScaleFactor);
  compareViewport(mismatches, 'viewport', actual.viewport, gate.viewport);
  compareViewport(mismatches, 'reflowViewport', actual.reflowViewport, gate.reflowViewport);
  if (mismatches.length > 0) failEnvironment(mismatches);
  return actual;
}

export function requireReaderUsabilityBrowserPolicy(
  gate: ReaderUsabilityGate,
  actual: ReaderProfileBrowserPolicy,
): ReaderProfileBrowserPolicy {
  const mismatches: string[] = [];
  compare(mismatches, 'browser.isolation', actual.isolation, gate.browser.isolation);
  compare(mismatches, 'browser.channel', actual.channel, gate.browser.channel);
  compare(mismatches, 'browser.headless', actual.headless, gate.browser.headless);
  compare(mismatches, 'browser.locale', actual.locale, gate.browser.locale);
  compare(mismatches, 'browser.colorScheme', actual.colorScheme, gate.browser.colorScheme);
  if (mismatches.length > 0) failEnvironment(mismatches);
  return actual;
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
  requireMatchingReports(caseConfig, reports);
  const samples = reports.map(readerUsabilityMetrics);
  const p95 = mapReaderUsabilityMetrics((key) =>
    nearestRank95(samples.map((sample) => sample[key])),
  );
  requireThresholds(caseConfig, p95);
  return {
    caseId: caseConfig.id,
    fixtureSha256: caseConfig.sha256,
    runs: expectedRuns,
    p95,
    thresholds: { ...caseConfig.thresholds },
  };
}

function requireMatchingReports(
  caseConfig: ReaderUsabilityGateCase,
  reports: readonly ReaderLoadProfileReport[],
): void {
  const first = reports[0];
  for (const [index, report] of reports.entries()) {
    if (report.fixture.id !== caseConfig.id || report.fixture.sha256 !== caseConfig.sha256) {
      throw new Error(
        `Reader usability case "${caseConfig.id}" report ${String(index + 1)} fixture identity mismatch`,
      );
    }
    if (first && !sameEnvironment(report.environment, first.environment)) {
      throw new Error(
        `Reader usability case "${caseConfig.id}" report ${String(index + 1)} environment mismatch`,
      );
    }
    if (first && !sameBrowserPolicy(report.startup.browser, first.startup.browser)) {
      throw new Error(
        `Reader usability case "${caseConfig.id}" report ${String(index + 1)} browser policy mismatch`,
      );
    }
  }
}

function requireThresholds(caseConfig: ReaderUsabilityGateCase, p95: ReaderUsabilityMetrics): void {
  const exceeded = READER_USABILITY_METRIC_KEYS.filter(
    (key) => p95[key] > caseConfig.thresholds[key],
  );
  if (exceeded.length === 0) return;
  const details = exceeded.map(
    (key) =>
      `- ${key}: p95 ${String(p95[key])} ${metricUnit(key)} > ${String(caseConfig.thresholds[key])} ${metricUnit(key)}`,
  );
  throw new Error(
    `Reader usability thresholds exceeded for "${caseConfig.id}":\n${details.join('\n')}`,
  );
}

function metricUnit(key: keyof ReaderUsabilityMetrics): 'ms' | 'requests' {
  return key === 'farTocWorkerRequestsToFirstFrame' ? 'requests' : 'ms';
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
    left.chapterLocalPreviewMode === right.chapterLocalPreviewMode &&
    sameRuntimeValue(left.artifact.schemaVersion, right.artifact.schemaVersion) &&
    sameRuntimeValue(left.artifact.id, right.artifact.id) &&
    left.artifact.readerDistSha256 === right.artifact.readerDistSha256 &&
    left.artifact.fileCount === right.artifact.fileCount &&
    left.artifact.byteLength === right.artifact.byteLength &&
    left.execution.skippedE2eBuild === right.execution.skippedE2eBuild &&
    left.execution.strictServer === right.execution.strictServer &&
    left.execution.abPairId === right.execution.abPairId &&
    left.execution.abOrder === right.execution.abOrder &&
    READER_USABILITY_MACHINE_ENVIRONMENT_KEYS.every((key) => left[key] === right[key]) &&
    left.deviceScaleFactor === right.deviceScaleFactor &&
    sameViewport(left.viewport, right.viewport) &&
    sameViewport(left.reflowViewport, right.reflowViewport)
  );
}

function sameRuntimeValue(left: unknown, right: unknown): boolean {
  return left === right;
}

function sameBrowserPolicy(
  left: ReaderProfileBrowserPolicy,
  right: ReaderProfileBrowserPolicy,
): boolean {
  return (
    left.isolation === right.isolation &&
    left.channel === right.channel &&
    left.headless === right.headless &&
    left.locale === right.locale &&
    left.colorScheme === right.colorScheme
  );
}

function sameViewport(left: ReaderProfileViewport, right: ReaderProfileViewport): boolean {
  return left.width === right.width && left.height === right.height;
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
  if (actual !== expected) {
    errors.push(
      `- ${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

function failEnvironment(mismatches: readonly string[]): never {
  throw new Error(`Reader usability environment mismatch:\n${mismatches.join('\n')}`);
}
