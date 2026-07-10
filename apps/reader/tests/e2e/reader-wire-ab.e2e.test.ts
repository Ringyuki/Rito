import { expect, test, type TestInfo } from '@playwright/test';
import { summarizeNumbers } from './reader-wire-metrics';
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
  }
}
