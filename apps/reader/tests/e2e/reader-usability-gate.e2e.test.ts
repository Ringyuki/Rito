import { expect, test, type Browser, type BrowserType, type TestInfo } from '@playwright/test';
import { basename } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { ReaderLoadProfileReport } from './reader-profile-model';
import { readReaderProfileFixtureIdentity, runReaderLoadProfile } from './reader-profile-runner';
import {
  readerProfileExecutionIdentity,
  readReaderProfileArtifactIdentity,
} from './reader-profile-artifact';
import { requireProductionPinnedFontExpectations } from './reader-production-pinned-font-contract';
import { READER_TEST_SERVER_BASE_URL } from './reader-test-server';
import {
  evaluateReaderUsabilityCase,
  loadReaderUsabilityGate,
  requireReaderUsabilityBrowserPolicy,
  requireReaderUsabilityEnvironment,
  type ReaderUsabilityCaseSummary,
  type ReaderUsabilityGate,
  type ReaderUsabilityGateCase,
} from './reader-usability-gate';
import { installReaderWorkerProbe } from './reader-worker-probe';
import {
  installReaderChapterLocalPreviewMode,
  readerChapterLocalPreviewModeFromEnv,
} from './reader-chapter-local-preview-mode';

const GATE_PATH = process.env['RITO_READER_USABILITY_GATE'];
const MACHINE_ID = process.env['RITO_READER_MACHINE_ID'];
const GATE_REQUIRED = process.env['RITO_READER_USABILITY_GATE_REQUIRED'] === '1';
const RUN_TIMEOUT_MS = 240_000;

if (GATE_REQUIRED && GATE_PATH === undefined) {
  throw new Error('RITO_READER_USABILITY_GATE must identify a gate manifest');
}

test.use({ trace: 'off', video: 'off' });

test.describe('named-machine reader usability gate', () => {
  test.skip(GATE_PATH === undefined, 'Set RITO_READER_USABILITY_GATE to a gate manifest');

  test('meets every corpus and stage threshold', async ({ playwright, browserName }, testInfo) => {
    const gate = await loadConfiguredGate();
    const machineId = requireMachineId();
    requireLaunchConfiguration(gate, browserName);
    requireProductionPinnedFontExpectations(gate.pinnedFonts);
    test.setTimeout(gate.runs * gate.cases.length * RUN_TIMEOUT_MS + 30_000);
    const summaries: ReaderUsabilityCaseSummary[] = [];

    for (const caseConfig of gate.cases) {
      const reports = await runCase(playwright.chromium, gate, caseConfig, machineId, testInfo);
      summaries.push(evaluateReaderUsabilityCase(caseConfig, reports, gate.runs));
    }

    await attachJson(testInfo, 'reader-usability-gate-summary', {
      schemaVersion: gate.schemaVersion,
      machine: gate.machine,
      browser: gate.browser,
      pinnedFonts: gate.pinnedFonts,
      deviceScaleFactor: gate.deviceScaleFactor,
      viewport: gate.viewport,
      reflowViewport: gate.reflowViewport,
      summaries,
    });
    console.log(`Rito reader usability gate\n${JSON.stringify(summaries, null, 2)}`);
  });
});

async function runCase(
  browserType: BrowserType,
  gate: ReaderUsabilityGate,
  caseConfig: ReaderUsabilityGateCase,
  machineId: string,
  testInfo: TestInfo,
): Promise<ReaderLoadProfileReport[]> {
  const reports: ReaderLoadProfileReport[] = [];
  for (let run = 1; run <= gate.runs; run += 1) {
    const launchStartedAt = performance.now();
    const browser = await browserType.launch({ headless: gate.browser.headless });
    const browserLaunchMs = performance.now() - launchStartedAt;
    try {
      const report = await runBrowserSample(browser, gate, caseConfig, machineId, browserLaunchMs);
      await attachJson(testInfo, `${caseConfig.id}-run-${String(run)}`, report);
      reports.push(report);
    } finally {
      await browser.close();
    }
  }
  return reports;
}

async function runBrowserSample(
  browser: Browser,
  gate: ReaderUsabilityGate,
  caseConfig: ReaderUsabilityGateCase,
  machineId: string,
  browserLaunchMs: number,
): Promise<ReaderLoadProfileReport> {
  requireBrowserIdentity(gate, browser);
  const context = await browser.newContext({
    baseURL: READER_TEST_SERVER_BASE_URL,
    viewport: gate.viewport,
    deviceScaleFactor: gate.deviceScaleFactor,
    locale: gate.browser.locale,
    colorScheme: gate.browser.colorScheme,
  });
  try {
    await installReaderChapterLocalPreviewMode(
      context,
      readerChapterLocalPreviewModeFromEnv(process.env),
    );
    await installReaderWorkerProbe(context);
    const page = await context.newPage();
    const fixture = readReaderProfileFixtureIdentity(caseConfig.id, caseConfig.epub);
    const report = await runReaderLoadProfile(page, browser, {
      fixture,
      epubPath: caseConfig.epub,
      machineId,
      viewport: gate.viewport,
      reflowViewport: gate.reflowViewport,
      browserPolicy: gate.browser,
      browserLaunchMs,
      artifact: readReaderProfileArtifactIdentity(),
      execution: readerProfileExecutionIdentity(process.env),
    });
    requireReaderUsabilityEnvironment(gate, report.environment, MACHINE_ID);
    requireReaderUsabilityBrowserPolicy(gate, report.startup.browser);
    expect(report.browserErrors, report.browserErrors.join('\n')).toEqual([]);
    return report;
  } finally {
    await context.close();
  }
}

function requireLaunchConfiguration(gate: ReaderUsabilityGate, browserName: string): void {
  if (browserName !== 'chromium' || gate.machine.browserName !== browserName) {
    throw new Error(
      `Reader usability gate requires chromium, received project ${browserName} and manifest ${gate.machine.browserName}`,
    );
  }
  if (process.env['PLAYWRIGHT_BROWSER_CHANNEL'] !== undefined) {
    throw new Error(
      'Reader usability gate requires bundled Chromium; unset PLAYWRIGHT_BROWSER_CHANNEL',
    );
  }
}

function requireBrowserIdentity(gate: ReaderUsabilityGate, browser: Browser): void {
  const actualName = browser.browserType().name();
  const actualVersion = browser.version();
  if (actualName !== gate.machine.browserName || actualVersion !== gate.machine.browserVersion) {
    throw new Error(
      `Reader usability browser mismatch: expected ${gate.machine.browserName} ${gate.machine.browserVersion}, received ${actualName} ${actualVersion}`,
    );
  }
}

function loadConfiguredGate(): Promise<ReaderUsabilityGate> {
  if (GATE_PATH === undefined) throw new Error('missing RITO_READER_USABILITY_GATE');
  return loadReaderUsabilityGate(GATE_PATH);
}

function requireMachineId(): string {
  if (MACHINE_ID === undefined || MACHINE_ID.trim().length === 0) {
    throw new Error('RITO_READER_MACHINE_ID must name the machine declared by the gate');
  }
  return MACHINE_ID;
}

function attachJson(testInfo: TestInfo, name: string, value: unknown): Promise<void> {
  return testInfo.attach(`${basename(name, '.json')}.json`, {
    body: Buffer.from(JSON.stringify(value, null, 2)),
    contentType: 'application/json',
  });
}
