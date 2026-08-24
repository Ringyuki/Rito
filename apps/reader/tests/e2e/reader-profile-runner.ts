import { expect, type Browser, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { arch, cpus, platform, release } from 'node:os';
import {
  buildReaderLoadProfileReport,
  type ReaderLoadProfileReport,
  type ReaderProfileArtifactIdentity,
  type ReaderProfileBrowserPolicy,
  type ReaderProfileEnvironment,
  type ReaderProfileExecutionIdentity,
  type ReaderProfileFixture,
  type ReaderProfileViewport,
} from './reader-profile-model';
import { buildReaderProfileStartup } from './reader-profile-startup';
import { readReaderChapterLocalPreviewMode } from './reader-chapter-local-preview-mode';
import { runFreshFarBootstrap } from './reader-profile-fresh-far';
import { readReaderLongTasks, readReaderWorkerOperations } from './reader-worker-probe';
import {
  runCachedTurnProfile,
  runDeferredGrowthProfile,
  runInitialProfile,
  runReflowProfile,
} from './reader-profile-stages';
import { runFarTocProfile, runTocSupersedeProfile } from './reader-profile-toc-stages';
import { requireProfileProtocol } from './reader-profile-protocol';
import {
  installReaderStartupProbe,
  waitForReaderStartup,
  type ReaderStartupProbeSnapshot,
} from './reader-startup-probe';

export interface ReaderLoadProfileOptions {
  readonly fixture: ReaderProfileFixture;
  readonly epubPath: string;
  readonly machineId: string;
  readonly viewport: ReaderProfileViewport;
  readonly reflowViewport: ReaderProfileViewport;
  readonly browserPolicy: ReaderProfileBrowserPolicy;
  readonly browserLaunchMs: number | null;
  readonly artifact: ReaderProfileArtifactIdentity;
  readonly execution: ReaderProfileExecutionIdentity;
}

interface BrowserErrorCollector {
  readonly errors: string[];
  readonly stop: () => void;
}

export async function runReaderLoadProfile(
  page: Page,
  browser: Browser,
  options: ReaderLoadProfileOptions,
): Promise<ReaderLoadProfileReport> {
  requireDistinctViewports(options.viewport, options.reflowViewport);
  requireFixtureIdentity(
    options.fixture,
    readReaderProfileFixtureIdentity(options.fixture.id, options.epubPath),
  );
  const errors = collectBrowserErrors(page);
  try {
    await installReaderStartupProbe(page);
    const startup = await prepareProfilePage(page, options.viewport);
    const initial = await runInitialProfile(page, options.epubPath);
    const cachedTurn = await runCachedTurnProfile(page, initial.checksum);
    const deferredGrowth = await runDeferredGrowthProfile(page, cachedTurn.checksum);
    const tocSupersede = await runTocSupersedeProfile(page, deferredGrowth.checksum);
    const reflow = await runReflowProfile(page, options.reflowViewport, tocSupersede.checksum);
    const mainOperations = await readReaderWorkerOperations(page);
    const mainLongTasks = await readReaderLongTasks(page);
    const environment = await profileEnvironment(page, browser, options);
    const profileStartup = buildReaderProfileStartup({
      browser: options.browserPolicy,
      browserLaunchMs: options.browserLaunchMs,
      snapshot: startup,
      firstCanvasAt: initial.canvasAt,
      longTasks: mainLongTasks,
    });
    const freshFarBootstrap = await runFreshFarBootstrap(
      page,
      options.epubPath,
      options.viewport,
      mainOperations,
    );
    const freshPreviewMode = await readReaderChapterLocalPreviewMode(page);
    if (freshPreviewMode !== environment.chapterLocalPreviewMode) {
      throw new Error('Reader chapter-local preview mode changed across fresh far bootstrap');
    }
    const farToc = await runFarTocProfile(page, freshFarBootstrap.checksum);
    const freshOperations = await readReaderWorkerOperations(page);
    const freshLongTasks = await readReaderLongTasks(page);
    const operations = [...mainOperations, ...freshOperations];
    const longTasks = [...mainLongTasks, ...freshLongTasks];
    requireProfileProtocol(
      initial,
      cachedTurn,
      deferredGrowth,
      tocSupersede,
      reflow,
      freshFarBootstrap,
      farToc,
      operations,
      environment.chapterLocalPreviewMode,
    );
    requireFixtureIdentity(
      options.fixture,
      readReaderProfileFixtureIdentity(options.fixture.id, options.epubPath),
    );
    return buildReaderLoadProfileReport({
      generatedAt: new Date().toISOString(),
      environment,
      fixture: options.fixture,
      startup: profileStartup,
      startedAt: initial.startedAt,
      loadedAt: initial.loadedAt,
      canvasAt: initial.canvasAt,
      initial: initial.stage,
      cachedTurn: cachedTurn.stage,
      deferredGrowth: deferredGrowth.stage,
      tocSupersede: tocSupersede.stage,
      freshFarBootstrap: freshFarBootstrap.stage,
      farToc: farToc.stage,
      reflow,
      cachedTurnTransition: cachedTurn.transition,
      deferredGrowthTransition: deferredGrowth.transition,
      tocSupersedeTransition: tocSupersede.transition,
      freshFarGeneration: freshFarBootstrap.generation,
      farTocTransition: farToc.transition,
      operations,
      longTasks,
      browserErrors: errors.errors,
    });
  } finally {
    errors.stop();
  }
}

async function prepareProfilePage(
  page: Page,
  viewport: ReaderProfileViewport,
): Promise<ReaderStartupProbeSnapshot> {
  await page.setViewportSize(viewport);
  await page.goto('/');
  const startup = await waitForReaderStartup(page);
  await expect(page.getByTestId('reader-empty')).toBeVisible();
  return startup;
}

async function profileEnvironment(
  page: Page,
  browser: Browser,
  options: ReaderLoadProfileOptions,
): Promise<ReaderProfileEnvironment> {
  return {
    machineId: options.machineId,
    platform: platform(),
    arch: arch(),
    cpuModel: cpus()[0]?.model ?? 'unknown',
    osRelease: release(),
    browserName: browser.browserType().name(),
    browserVersion: browser.version(),
    chapterLocalPreviewMode: await readReaderChapterLocalPreviewMode(page),
    artifact: options.artifact,
    execution: options.execution,
    deviceScaleFactor: await page.evaluate(() => devicePixelRatio),
    viewport: options.viewport,
    reflowViewport: options.reflowViewport,
  };
}

export function readReaderProfileFixtureIdentity(id: string, path: string): ReaderProfileFixture {
  const bytes = readFileSync(path);
  return {
    id,
    path,
    byteLength: statSync(path).size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function requireFixtureIdentity(
  expected: ReaderProfileFixture,
  actual: ReaderProfileFixture,
): void {
  if (
    expected.id !== actual.id ||
    expected.path !== actual.path ||
    expected.byteLength !== actual.byteLength ||
    expected.sha256 !== actual.sha256
  ) {
    throw new Error('Reader profile EPUB changed during the measurement');
  }
}

function collectBrowserErrors(page: Page): BrowserErrorCollector {
  const errors: string[] = [];
  const consoleError = (message: { type(): string; text(): string }): void => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  };
  const pageError = (error: Error): void => {
    errors.push(`page: ${error.stack ?? error.message}`);
  };
  page.on('console', consoleError);
  page.on('pageerror', pageError);
  return {
    errors,
    stop: () => {
      page.off('console', consoleError);
      page.off('pageerror', pageError);
    },
  };
}

function requireDistinctViewports(
  viewport: ReaderProfileViewport,
  reflowViewport: ReaderProfileViewport,
): void {
  if (viewport.width === reflowViewport.width && viewport.height === reflowViewport.height) {
    throw new Error('Reader profile reflow viewport must differ from its initial viewport');
  }
}
