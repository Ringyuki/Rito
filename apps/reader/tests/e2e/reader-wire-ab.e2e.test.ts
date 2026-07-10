import { expect, test, type TestInfo } from '@playwright/test';
import { summarizeNumbers, summarizeScalars } from './reader-wire-metrics';
import { runWireSession, type WireSessionReport } from './reader-wire-session';

const SESSION_ORDER = ['json', 'ritorb1', 'ritorb1', 'json'] as const;

test.use({ trace: 'off', video: 'off' });

test.describe('real WebWorker RITORB1 A/B sessions', () => {
  test.skip(process.env['RITO_WIRE_AB'] !== '1', 'Run with pnpm test:e2e:wire-ab');

  test('runs ABBA sessions through preview, full reflow, and real page turns', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(300_000);
    const baseURL = configuredBaseURL(testInfo);
    const sessions: WireSessionReport[] = [];
    for (const [sessionIndex, wire] of SESSION_ORDER.entries()) {
      sessions.push(await runWireSession(browser, baseURL, wire, sessionIndex));
    }

    const report = buildReport(sessions);
    const json = JSON.stringify(report, null, 2);
    console.log(`RITORB1 WebWorker A/B report\n${json}`);
    await testInfo.attach('reader-wire-ab-report', {
      body: Buffer.from(json),
      contentType: 'application/json',
    });
    assertFunctionalParity(sessions);
  });
});

function configuredBaseURL(testInfo: TestInfo): string {
  const value = testInfo.project.use.baseURL;
  if (typeof value !== 'string') throw new Error('reader wire A/B requires a Playwright baseURL');
  return value;
}

function buildReport(sessions: readonly WireSessionReport[]) {
  return {
    generatedAt: new Date().toISOString(),
    order: SESSION_ORDER,
    sessions,
    summaries: (['json', 'ritorb1'] as const).map((wire) => summarizeWire(sessions, wire)),
  };
}

function summarizeWire(sessions: readonly WireSessionReport[], wire: 'json' | 'ritorb1') {
  const matching = sessions.filter((session) => session.wire === wire);
  const turns = matching.flatMap((session) => [
    ...session.initialTurns.turns,
    ...session.reflowTurns.turns,
  ]);
  return {
    wire,
    sessions: matching.length,
    initialPreviewReady: summarizeNumbers(
      matching.map((session) => session.initial.previewReadyMs),
    ),
    initialFullReady: summarizeNumbers(matching.map((session) => session.initial.fullReadyMs)),
    settingsFullReady: summarizeNumbers(matching.map((session) => session.reflow.fullReadyMs)),
    turnReadiness: summarizeNumbers(turns.map((turn) => turn.readinessMs)),
    turnFrameGapP95: summarizeNumbers(turns.map((turn) => turn.frameGaps.p95Ms)),
    initialPreview: summarizeRevisionPhase(matching.map((session) => session.initial.preview)),
    initialFull: summarizeRevisionPhase(matching.map((session) => session.initial.full)),
    reflowPreview: summarizeRevisionPhase(matching.map((session) => session.reflow.preview)),
    reflowFull: summarizeRevisionPhase(matching.map((session) => session.reflow.full)),
  };
}

type RevisionObservation = WireSessionReport['revisions'][number];

function summarizeRevisionPhase(revisions: readonly RevisionObservation[]) {
  const metrics = revisions.flatMap((revision) => (revision.metrics ? [revision.metrics] : []));
  return {
    rawWireBytes: summarizeScalars(metrics.map((entry) => entry.rawWireBytes)),
    wasmMethodMs: summarizeScalars(metrics.map((entry) => entry.wasmMethodMs)),
    rustEncodeMs: summarizeScalars(metrics.map((entry) => entry.rustEncodeMs)),
    jsDecodeMs: summarizeScalars(metrics.map((entry) => entry.jsDecodeMs)),
    workerProcessingMs: summarizeScalars(metrics.map((entry) => entry.workerProcessingMs)),
    workerRoundTripMs: summarizeScalars(
      revisions.flatMap((revision) =>
        typeof revision.durationMs === 'number' ? [revision.durationMs] : [],
      ),
    ),
  };
}

function assertFunctionalParity(sessions: readonly WireSessionReport[]): void {
  const baseline = sessions[0];
  if (!baseline) throw new Error('reader wire A/B produced no sessions');
  for (const session of sessions) {
    expect(session.observedWire).toBe(session.wire);
    expect(session.bookTitle).toBe(baseline.bookTitle);
    expect(session.canvasNonBlank).toBe(true);
    expect(session.consoleErrors).toEqual([]);
    expect(session.pageErrors).toEqual([]);
    expect(session.initial.preview.spreadCount).toBe(baseline.initial.preview.spreadCount);
    expect(session.initial.full.spreadCount).toBe(baseline.initial.full.spreadCount);
    expect(session.reflow.preview.spreadCount).toBe(baseline.reflow.preview.spreadCount);
    expect(session.reflow.full.spreadCount).toBe(baseline.reflow.full.spreadCount);
    expect(session.initialTurns.endingSpread).toBe(0);
    expect(session.reflowTurns.endingSpread).toBe(0);
    expect(session.revisions.length).toBeGreaterThanOrEqual(4);
    expect(session.revisions.every((revision) => revision.wire === session.wire)).toBe(true);
    expect(session.revisions.every((revision) => revision.ok === true)).toBe(true);
    for (const revision of session.revisions.filter((entry) => entry.ok === true)) {
      assertRevisionMetrics(revision);
    }
  }
}

function assertRevisionMetrics(revision: WireSessionReport['revisions'][number]): void {
  expect(revision.metrics).not.toBeNull();
  if (!revision.metrics) return;
  assertFiniteNonNegative(revision.metrics.rawWireBytes, 'rawWireBytes');
  expect(revision.metrics.rawWireBytes).toBeGreaterThan(0);
  assertFiniteNonNegative(revision.metrics.wasmMethodMs, 'wasmMethodMs');
  assertFiniteNonNegative(revision.metrics.rustEncodeMs, 'rustEncodeMs');
  assertFiniteNonNegative(revision.metrics.jsDecodeMs, 'jsDecodeMs');
  assertFiniteNonNegative(revision.metrics.workerProcessingMs, 'workerProcessingMs');
  assertFiniteNonNegative(revision.durationMs, 'workerRoundTripMs');
}

function assertFiniteNonNegative(value: unknown, name: string): void {
  expect(typeof value, `${name} must be a number`).toBe('number');
  if (typeof value !== 'number') return;
  expect(Number.isFinite(value), `${name} must be finite`).toBe(true);
  expect(value, `${name} must be non-negative`).toBeGreaterThanOrEqual(0);
}
