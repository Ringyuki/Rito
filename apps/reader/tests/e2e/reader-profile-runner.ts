import { expect, type Browser, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { arch, cpus, platform, release } from 'node:os';
import {
  buildReaderLoadProfileReport,
  type ReaderLoadProfileReport,
  type ReaderProfileEnvironment,
  type ReaderProfileViewport,
} from './reader-profile-model';
import { readReaderLongTasks, readReaderWorkerOperations } from './reader-worker-probe';
import {
  runCachedTurnProfile,
  runDeferredGrowthProfile,
  runInitialProfile,
  runReflowProfile,
} from './reader-profile-stages';
import { requireProfileProtocol } from './reader-profile-protocol';

export interface ReaderLoadProfileOptions {
  readonly fixtureId: string;
  readonly epubPath: string;
  readonly machineId: string;
  readonly viewport: ReaderProfileViewport;
  readonly reflowViewport: ReaderProfileViewport;
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
  const errors = collectBrowserErrors(page);
  try {
    await prepareProfilePage(page, options.viewport);
    const initial = await runInitialProfile(page, options.epubPath);
    const cachedTurn = await runCachedTurnProfile(page, initial.checksum);
    const deferredGrowth = await runDeferredGrowthProfile(page, cachedTurn.checksum);
    const reflow = await runReflowProfile(page, options.reflowViewport, deferredGrowth.checksum);
    const operations = await readReaderWorkerOperations(page);
    const longTasks = await readReaderLongTasks(page);
    requireProfileProtocol(initial, cachedTurn, deferredGrowth, reflow, operations);
    return buildReaderLoadProfileReport({
      generatedAt: new Date().toISOString(),
      environment: await profileEnvironment(page, browser, options),
      fixture: profileFixture(options.fixtureId, options.epubPath),
      startedAt: initial.startedAt,
      loadedAt: initial.loadedAt,
      canvasAt: initial.canvasAt,
      initial: initial.stage,
      cachedTurn: cachedTurn.stage,
      deferredGrowth: deferredGrowth.stage,
      reflow,
      cachedTurnTransition: cachedTurn.transition,
      deferredGrowthTransition: deferredGrowth.transition,
      operations,
      longTasks,
      browserErrors: errors.errors,
    });
  } finally {
    errors.stop();
  }
}

async function prepareProfilePage(page: Page, viewport: ReaderProfileViewport): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto('/');
  await expect(page.getByTestId('reader-empty')).toBeVisible();
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
    deviceScaleFactor: await page.evaluate(() => devicePixelRatio),
    viewport: options.viewport,
    reflowViewport: options.reflowViewport,
  };
}

function profileFixture(id: string, path: string) {
  const bytes = readFileSync(path);
  return {
    id,
    path,
    byteLength: statSync(path).size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
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
