import { expect, test, type TestInfo } from '@playwright/test';
import { existsSync, statSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { runReaderLoadProfile } from './reader-profile-runner';
import type { ReaderLoadProfileReport } from './reader-profile-model';
import { installReaderWorkerProbe } from './reader-worker-probe';

const PROFILE_EPUB = configuredEpubPath();
const PROFILE_VIEWPORT = { width: 1280, height: 720 } as const;
const PROFILE_REFLOW_VIEWPORT = { width: 1120, height: 720 } as const;

test.use({ trace: 'off', video: 'off' });

test.describe('production bounded reader load profile', () => {
  test.skip(PROFILE_EPUB === undefined, 'Set RITO_READER_PROFILE_EPUB to an absolute EPUB path');

  test('records first paint, cached turn, deferred growth, and reflow', async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(240_000);
    const epubPath = requireProfileEpub();
    await installReaderWorkerProbe(page);
    const report = await runReaderLoadProfile(page, browser, {
      fixtureId: basename(epubPath, '.epub'),
      epubPath,
      machineId: process.env['RITO_READER_MACHINE_ID'] ?? 'report-only',
      viewport: PROFILE_VIEWPORT,
      reflowViewport: PROFILE_REFLOW_VIEWPORT,
    });
    const json = JSON.stringify(report, null, 2);
    console.log(
      `Rito bounded reader load profile\n${JSON.stringify(consoleSummary(report), null, 2)}`,
    );
    await attachReport(testInfo, json);

    expect(report.browserErrors, report.browserErrors.join('\n')).toEqual([]);
  });
});

function consoleSummary(report: ReaderLoadProfileReport) {
  return {
    fixture: report.fixture,
    environment: report.environment,
    milestones: report.milestones,
    stages: {
      initial: stageSummary(report.stages.initial),
      cachedTurn: stageSummary(report.stages.cachedTurn),
      deferredGrowth: stageSummary(report.stages.deferredGrowth),
      reflow: stageSummary(report.stages.reflow),
    },
    transitions: report.transitions,
    longTasks: report.longTasks,
  };
}

function stageSummary(stage: ReaderLoadProfileReport['stages']['initial']) {
  return {
    firstFrameMs: stage.durationMs,
    observedUntilStableMs: stage.observedDurationMs,
    longTasks: stage.longTasks,
  };
}

function configuredEpubPath(): string | undefined {
  const configured = process.env['RITO_READER_PROFILE_EPUB'];
  if (configured === undefined) return undefined;
  if (!isAbsolute(configured)) throw new Error('RITO_READER_PROFILE_EPUB must be absolute');
  const path = resolve(configured);
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`RITO_READER_PROFILE_EPUB must identify a file: ${path}`);
  }
  return path;
}

function requireProfileEpub(): string {
  if (PROFILE_EPUB === undefined) throw new Error('missing RITO_READER_PROFILE_EPUB');
  return PROFILE_EPUB;
}

function attachReport(testInfo: TestInfo, json: string): Promise<void> {
  return testInfo.attach(`reader-load-profile-${basename(requireProfileEpub())}`, {
    body: Buffer.from(json),
    contentType: 'application/json',
  });
}
