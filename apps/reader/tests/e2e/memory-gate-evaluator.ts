import { arch, cpus, platform, release } from 'node:os';
import {
  READER_MEMORY_METRIC_KEYS,
  type ReaderMemoryEnvironment,
  type ReaderMemoryGate,
  type ReaderMemoryGateReport,
  type ReaderMemoryGateSummary,
  type ReaderMemoryMetrics,
} from './memory-gate-types';
import { measureReaderMemoryMetrics } from './memory-gate-report';

export function requireReaderMemoryHost(gate: ReaderMemoryGate, machineId: string): void {
  const mismatches: string[] = [];
  compare(mismatches, 'machine.id', machineId, gate.machine.id);
  compare(mismatches, 'machine.platform', platform(), gate.machine.platform);
  compare(mismatches, 'machine.arch', arch(), gate.machine.arch);
  compare(mismatches, 'machine.cpuModel', cpus()[0]?.model ?? 'unknown', gate.machine.cpuModel);
  compare(mismatches, 'machine.osRelease', release(), gate.machine.osRelease);
  if (mismatches.length > 0) failMismatch('host', mismatches);
}

export function requireReaderMemoryEnvironment(
  gate: ReaderMemoryGate,
  environment: ReaderMemoryEnvironment,
): void {
  const mismatches: string[] = [];
  compare(mismatches, 'environment.machineId', environment.machineId, gate.machine.id);
  compare(mismatches, 'environment.platform', environment.platform, gate.machine.platform);
  compare(mismatches, 'environment.arch', environment.arch, gate.machine.arch);
  compare(mismatches, 'environment.cpuModel', environment.cpuModel, gate.machine.cpuModel);
  compare(mismatches, 'environment.osRelease', environment.osRelease, gate.machine.osRelease);
  compare(mismatches, 'environment.browserName', environment.browserName, gate.machine.browserName);
  compare(
    mismatches,
    'environment.browserVersion',
    environment.browserVersion,
    gate.machine.browserVersion,
  );
  compare(
    mismatches,
    'environment.deviceScaleFactor',
    environment.deviceScaleFactor,
    gate.deviceScaleFactor,
  );
  compare(mismatches, 'environment.locale', environment.locale, gate.browser.locale);
  compare(mismatches, 'environment.colorScheme', environment.colorScheme, gate.browser.colorScheme);
  compareViewport(mismatches, 'environment.viewport', environment.viewport, gate.viewport);
  compareViewport(
    mismatches,
    'environment.reflowViewport',
    environment.reflowViewport,
    gate.reflowViewport,
  );
  if (mismatches.length > 0) failMismatch('environment', mismatches);
}

export function evaluateReaderMemoryGate(
  gate: ReaderMemoryGate,
  reports: readonly ReaderMemoryGateReport[],
): ReaderMemoryGateSummary {
  if (reports.length !== gate.runs) {
    throw new Error(
      `Reader memory gate expected ${String(gate.runs)} reports, received ${String(reports.length)}`,
    );
  }
  const measuredReports = reports.map((report) => {
    requireMatchingReport(gate, report);
    const measured = measureReaderMemoryMetrics(report.checkpoints);
    if (JSON.stringify(report.metrics) !== JSON.stringify(measured)) {
      throw new Error('Reader memory report metrics do not match its checkpoints');
    }
    return measured;
  });
  requireConsistentReports(reports);
  const p95 = metricRecord((key) => nearestRankP95(measuredReports.map((metrics) => metrics[key])));
  const exceeded = READER_MEMORY_METRIC_KEYS.flatMap((key) =>
    p95[key] > gate.thresholds[key]
      ? [`- ${key}: p95 ${String(p95[key])} MiB > ${String(gate.thresholds[key])} MiB`]
      : [],
  );
  if (exceeded.length > 0) {
    throw new Error(`Reader memory gate thresholds exceeded:\n${exceeded.join('\n')}`);
  }
  return {
    fixtureId: gate.fixture.id,
    fixtureSha256: gate.fixture.sha256,
    runs: gate.runs,
    p95,
    thresholds: gate.thresholds,
    runMetrics: measuredReports,
  };
}

function requireMatchingReport(gate: ReaderMemoryGate, report: ReaderMemoryGateReport): void {
  requireReaderMemoryEnvironment(gate, report.environment);
  if (report.fixture.id !== gate.fixture.id || report.fixture.sha256 !== gate.fixture.sha256) {
    throw new Error('Reader memory report fixture identity mismatch');
  }
  if (JSON.stringify(report.browser) !== JSON.stringify(gate.browser)) {
    throw new Error('Reader memory report browser policy mismatch');
  }
  if (JSON.stringify(report.scenario) !== JSON.stringify(gate.scenario)) {
    throw new Error('Reader memory report scenario mismatch');
  }
  if (report.workerLifecycle.liveWorkerIds.length > 0) {
    throw new Error('Reader memory report retained live workers after disposal');
  }
  requireScenarioEvidence(gate, report);
  requireCompleteWorkerLifecycle(report.workerLifecycle);
}

function requireScenarioEvidence(gate: ReaderMemoryGate, report: ReaderMemoryGateReport): void {
  const checkpoints = report.checkpoints;
  const expectedLabels = {
    baseline: 'app-ready',
    loaded: 'loaded',
    growth: 'growth',
    reflow: 'reflow',
    disposed: 'disposed',
  } as const;
  for (const [key, label] of Object.entries(expectedLabels)) {
    const checkpoint = checkpoints[key as keyof typeof expectedLabels];
    if (checkpoint.label !== label) {
      throw new Error(`Reader memory report checkpoint ${key} must be labelled ${label}`);
    }
  }
  if (checkpoints.replacements.length !== gate.scenario.replacementRounds) {
    throw new Error(
      'Reader memory report replacement checkpoint count does not match its scenario',
    );
  }
  for (const [index, checkpoint] of checkpoints.replacements.entries()) {
    if (checkpoint.label !== `replacement-${String(index + 1)}`) {
      throw new Error('Reader memory report replacement checkpoint labels are not contiguous');
    }
  }
  const expectedSuccessfulSessions = gate.scenario.replacementRounds + 2;
  const successfulSessions = report.workerLifecycle.sessions.filter(
    (session) => session.openSucceeded,
  ).length;
  if (successfulSessions !== expectedSuccessfulSessions) {
    throw new Error(
      `Reader memory report expected ${String(expectedSuccessfulSessions)} successful sessions, received ${String(successfulSessions)}`,
    );
  }
}

function requireCompleteWorkerLifecycle(
  lifecycle: ReaderMemoryGateReport['workerLifecycle'],
): void {
  const created = exactWorkerIdSet(
    lifecycle.createdWorkers.map((entry) => entry.workerId),
    'created workers',
  );
  const terminated = exactWorkerIdSet(
    lifecycle.terminations.map((entry) => entry.workerId),
    'terminated workers',
  );
  requireSameWorkerIds(created, terminated, 'terminated workers');
  const lastDisposeByWorker = new Map<number, number>();
  for (const [index, session] of lifecycle.sessions.entries()) {
    if (session.openOrdinal !== index + 1) {
      throw new Error('Reader memory report has a non-contiguous logical session sequence');
    }
    if (!created.has(session.workerId)) {
      throw new Error('Reader memory report has sessions outside the constructed worker set');
    }
    const previousDispose = lastDisposeByWorker.get(session.workerId);
    if (previousDispose !== undefined && session.openStartedAt < previousDispose) {
      throw new Error(
        `Reader memory worker ${String(session.workerId)} reopened before its previous dispose acknowledgement`,
      );
    }
    if (
      session.openCompletedAt < session.openStartedAt ||
      session.disposedAt < session.openCompletedAt
    ) {
      throw new Error('Reader memory report has an invalid logical session timestamp sequence');
    }
    if (session.openSucceeded && !session.releasedDocument) {
      throw new Error(
        `Reader memory worker ${String(session.workerId)} session ${String(session.openOrdinal)} did not release its document`,
      );
    }
    lastDisposeByWorker.set(session.workerId, session.disposedAt);
  }
  for (const termination of lifecycle.terminations) {
    const createdAt = lifecycle.createdWorkers.find(
      (entry) => entry.workerId === termination.workerId,
    )?.createdAt;
    const finalDispose = lastDisposeByWorker.get(termination.workerId);
    if (
      createdAt === undefined ||
      termination.terminatedAt < createdAt ||
      (finalDispose !== undefined && termination.terminatedAt < finalDispose)
    ) {
      throw new Error(
        `Reader memory worker ${String(termination.workerId)} terminated before lifecycle release completed`,
      );
    }
  }
}

function exactWorkerIdSet(workerIds: readonly number[], label: string): Set<number> {
  const ids = new Set(workerIds);
  if (ids.size !== workerIds.length) {
    throw new Error(`Reader memory report contains duplicate ${label}`);
  }
  return ids;
}

function requireSameWorkerIds(
  expected: ReadonlySet<number>,
  actual: ReadonlySet<number>,
  label: string,
): void {
  if (expected.size !== actual.size || [...expected].some((workerId) => !actual.has(workerId))) {
    throw new Error(`Reader memory report has incomplete ${label}`);
  }
}

function requireConsistentReports(reports: readonly ReaderMemoryGateReport[]): void {
  const first = reports[0];
  if (!first) throw new Error('Reader memory gate has no reports');
  for (const report of reports.slice(1)) {
    if (JSON.stringify(report.environment) !== JSON.stringify(first.environment)) {
      throw new Error('Reader memory report environment mismatch between runs');
    }
  }
}

function nearestRankP95(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  const value = sorted[index];
  if (value === undefined) throw new Error('Reader memory metric has no samples');
  return value;
}

function metricRecord(value: (key: keyof ReaderMemoryMetrics) => number): ReaderMemoryMetrics {
  return Object.fromEntries(
    READER_MEMORY_METRIC_KEYS.map((key) => [key, value(key)]),
  ) as unknown as ReaderMemoryMetrics;
}

function compareViewport(
  mismatches: string[],
  label: string,
  actual: { readonly width: number; readonly height: number },
  expected: { readonly width: number; readonly height: number },
): void {
  compare(mismatches, `${label}.width`, actual.width, expected.width);
  compare(mismatches, `${label}.height`, actual.height, expected.height);
}

function compare(
  mismatches: string[],
  label: string,
  actual: string | number,
  expected: string | number,
): void {
  if (actual !== expected) {
    mismatches.push(
      `- ${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

function failMismatch(subject: string, mismatches: readonly string[]): never {
  throw new Error(`Reader memory ${subject} mismatch:\n${mismatches.join('\n')}`);
}
