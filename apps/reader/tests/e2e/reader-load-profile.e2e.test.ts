import { expect, test, type TestInfo } from '@playwright/test';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { readReaderProfileFixtureIdentity, runReaderLoadProfile } from './reader-profile-runner';
import type { ReaderLoadProfileReport } from './reader-profile-model';
import {
  readerProfileExecutionIdentity,
  readReaderProfileArtifactIdentity,
} from './reader-profile-artifact';
import { installReaderWorkerProbe } from './reader-worker-probe';
import {
  installReaderChapterLocalPreviewMode,
  readerChapterLocalPreviewModeFromEnv,
} from './reader-chapter-local-preview-mode';

const PROFILE_EPUB = configuredEpubPath();
const PROFILE_VIEWPORT = { width: 1280, height: 720 } as const;
const PROFILE_REFLOW_VIEWPORT = { width: 1120, height: 720 } as const;

test.use({ trace: 'off', video: 'off' });

test.describe('production bounded reader load profile', () => {
  test.skip(PROFILE_EPUB === undefined, 'Set RITO_READER_PROFILE_EPUB to an absolute EPUB path');

  test('records first paint, growth, TOC latency and supersede, and reflow', async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(240_000);
    const epubPath = requireProfileEpub();
    const previewMode = readerChapterLocalPreviewModeFromEnv(process.env);
    const artifact = readReaderProfileArtifactIdentity();
    const execution = readerProfileExecutionIdentity(process.env);
    const fixture = readReaderProfileFixtureIdentity(basename(epubPath, '.epub'), epubPath);
    await installReaderChapterLocalPreviewMode(page, previewMode);
    await installReaderWorkerProbe(page);
    const report = await runReaderLoadProfile(page, browser, {
      fixture,
      epubPath,
      machineId: process.env['RITO_READER_MACHINE_ID'] ?? 'report-only',
      viewport: PROFILE_VIEWPORT,
      reflowViewport: PROFILE_REFLOW_VIEWPORT,
      browserPolicy: {
        isolation: 'process-per-run',
        channel: process.env['PLAYWRIGHT_BROWSER_CHANNEL'] ?? 'bundled',
        headless: true,
        locale: 'en-US',
        colorScheme: 'light',
      },
      browserLaunchMs: null,
      artifact,
      execution,
    });
    expect(readReaderProfileArtifactIdentity()).toEqual(artifact);
    const json = JSON.stringify(report, null, 2);
    writeConfiguredProfileOutput(json);
    console.log(
      `Rito bounded reader load profile (${previewMode} chapter-local preview)\n${JSON.stringify(consoleSummary(report), null, 2)}`,
    );
    await attachReport(testInfo, json, previewMode, execution.abPairId, execution.abOrder);

    expect(report.browserErrors, report.browserErrors.join('\n')).toEqual([]);
  });
});

function consoleSummary(report: ReaderLoadProfileReport) {
  return {
    chapterLocalPreviewMode: report.environment.chapterLocalPreviewMode,
    fixture: report.fixture,
    environment: report.environment,
    startup: report.startup,
    milestones: report.milestones,
    stages: {
      initial: stageSummary(report.stages.initial),
      cachedTurn: stageSummary(report.stages.cachedTurn),
      deferredGrowth: stageSummary(report.stages.deferredGrowth),
      tocSupersede: stageSummary(report.stages.tocSupersede),
      freshFarBootstrap: stageSummary(report.stages.freshFarBootstrap),
      farToc: {
        ...stageSummary(report.stages.farToc),
        workerRequestsToFirstFrame: report.stages.farToc.workerRequestsToFirstFrame,
        operationsByKind: report.stages.farToc.operationsByKind,
        continuationDiagnostics: continuationDiagnostics(report.stages.farToc),
        chapterLocalDiagnostics: chapterLocalDiagnostics(report.stages.farToc),
      },
      reflow: stageSummary(report.stages.reflow),
    },
    transitions: report.transitions,
    longTasks: report.longTasks,
  };
}

function writeConfiguredProfileOutput(json: string): void {
  const configured = process.env['RITO_READER_PROFILE_OUTPUT'];
  if (configured === undefined) return;
  if (!isAbsolute(configured)) throw new Error('RITO_READER_PROFILE_OUTPUT must be absolute');
  const path = resolve(configured);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${json}\n`, { flag: 'wx' });
}

function continuationDiagnostics(stage: ReaderLoadProfileReport['stages']['farToc']) {
  const continuationKinds = new Set([
    'continueRevision',
    'continueRevisionAfterTransferRelease',
    'continueRevisionTowardSourceLocator',
  ]);
  const operations = stage.operations.filter((entry) => continuationKinds.has(entry.kind));
  return {
    count: operations.length,
    budgetHistogram: histogram(operations.map((entry) => entry.maxTopLevelNodes)),
    batchLimitHistogram: histogram(operations.map((entry) => entry.maxQuanta)),
    advancedQuantaHistogram: histogram(operations.map((entry) => entry.advancedQuanta)),
    totalAdvancedQuanta: operations.reduce(
      (total, entry) => total + (entry.advancedQuanta ?? 1),
      0,
    ),
    processedTopLevelNodesHistogram: histogram(
      operations.map((entry) => entry.processedTopLevelNodes),
    ),
    totalProcessedTopLevelNodes: operations.reduce(
      (total, entry) => total + (entry.processedTopLevelNodes ?? 0),
      0,
    ),
  };
}

function chapterLocalDiagnostics(stage: ReaderLoadProfileReport['stages']['farToc']) {
  const operations = stage.operations.filter(
    (entry) =>
      entry.kind === 'createBoundedChapterLocalRevision' ||
      entry.kind === 'continueChapterLocalRevision',
  );
  return {
    count: operations.length,
    processedTopLevelNodesHistogram: histogram(
      operations.map((entry) => entry.processedTopLevelNodes),
    ),
    owners: operations.flatMap((entry) =>
      entry.chapterLocalRevision
        ? [
            {
              requestId: entry.requestId,
              revisionId: entry.chapterLocalRevision.revisionId,
              revisionVersion: entry.chapterLocalRevision.revisionVersion,
              chapterIndex: entry.chapterLocalRevision.chapterIndex,
              href: entry.chapterLocalRevision.href,
              status: entry.chapterLocalRevision.status,
              knownLocalPageCount: entry.chapterLocalRevision.knownLocalPageCount,
              knownLocalSpreadCount: entry.chapterLocalRevision.knownLocalSpreadCount,
            },
          ]
        : [],
    ),
  };
}

function histogram(values: readonly (number | null)[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) {
    const key = value === null ? 'unavailable' : String(value);
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

function stageSummary(stage: ReaderLoadProfileReport['stages']['initial']) {
  return {
    stageWindowToQualifyingFrameMs: stage.durationMs,
    observationWindowMs: stage.observedDurationMs,
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

function attachReport(
  testInfo: TestInfo,
  json: string,
  mode: 'enabled' | 'disabled',
  pairId: string | null,
  order: number | null,
): Promise<void> {
  const pair = pairId === null ? 'unpaired' : `${pairId}-${String(order)}`;
  return testInfo.attach(`reader-load-profile-${mode}-${pair}-${basename(requireProfileEpub())}`, {
    body: Buffer.from(json),
    contentType: 'application/json',
  });
}
