import { test, type Browser, type TestInfo } from '@playwright/test';
import { basename } from 'node:path';
import { requireProductionPinnedFontExpectations } from './reader-production-pinned-font-contract';
import {
  evaluateReaderMemoryGate,
  requireReaderMemoryEnvironment,
  requireReaderMemoryHost,
} from './memory-gate-evaluator';
import { loadReaderMemoryGate } from './memory-gate-parser';
import { runReaderMemoryGateSample } from './memory-runner';
import type { ReaderMemoryGate, ReaderMemoryGateReport } from './memory-gate-types';

const GATE_PATH = process.env['RITO_READER_MEMORY_GATE'];
const MACHINE_ID = process.env['RITO_READER_MACHINE_ID'];
const GATE_REQUIRED = process.env['RITO_READER_MEMORY_GATE_REQUIRED'] === '1';
const RUN_TIMEOUT_MS = 360_000;

if (GATE_REQUIRED && GATE_PATH === undefined) {
  throw new Error('RITO_READER_MEMORY_GATE must identify a memory gate manifest');
}

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test.describe('named-machine reader memory gate', () => {
  test.skip(GATE_PATH === undefined, 'Set RITO_READER_MEMORY_GATE to a memory gate manifest');

  test('releases workers and stays within physical-footprint thresholds', async ({
    playwright,
    browserName,
  }, testInfo) => {
    const gate = await loadConfiguredGate();
    const machineId = requireMachineId();
    requireLaunchConfiguration(browserName);
    requireReaderMemoryHost(gate, machineId);
    requireProductionPinnedFontExpectations(gate.pinnedFonts);
    test.setTimeout(gate.runs * RUN_TIMEOUT_MS + 30_000);
    const reports: ReaderMemoryGateReport[] = [];

    for (let run = 1; run <= gate.runs; run += 1) {
      const browser = await playwright.chromium.launch({ headless: gate.browser.headless });
      try {
        requireBrowserIdentity(gate, browser);
        const report = await runReaderMemoryGateSample(browser, gate, machineId);
        requireReaderMemoryEnvironment(gate, report.environment);
        await attachJson(testInfo, `reader-memory-run-${String(run)}`, report);
        console.log(
          `Rito reader memory run ${String(run)}\n${JSON.stringify(runSummary(report), null, 2)}`,
        );
        reports.push(report);
      } finally {
        await browser.close();
      }
    }

    const summary = evaluateReaderMemoryGate(gate, reports);
    await attachJson(testInfo, 'reader-memory-gate-summary', summary);
    console.log(`Rito reader memory gate\n${JSON.stringify(summary, null, 2)}`);
  });
});

function requireLaunchConfiguration(browserName: string): void {
  if (browserName !== 'chromium') {
    throw new Error(`Reader memory gate requires chromium, received ${browserName}`);
  }
  if (process.env['PLAYWRIGHT_BROWSER_CHANNEL'] !== undefined) {
    throw new Error(
      'Reader memory gate requires bundled Chromium; unset PLAYWRIGHT_BROWSER_CHANNEL',
    );
  }
}

function requireBrowserIdentity(gate: ReaderMemoryGate, browser: Browser): void {
  const actualName = browser.browserType().name();
  const actualVersion = browser.version();
  if (actualName !== gate.machine.browserName || actualVersion !== gate.machine.browserVersion) {
    throw new Error(
      `Reader memory browser mismatch: expected ${gate.machine.browserName} ${gate.machine.browserVersion}, received ${actualName} ${actualVersion}`,
    );
  }
}

function loadConfiguredGate(): Promise<ReaderMemoryGate> {
  if (GATE_PATH === undefined) throw new Error('missing RITO_READER_MEMORY_GATE');
  return loadReaderMemoryGate(GATE_PATH);
}

function requireMachineId(): string {
  if (MACHINE_ID === undefined || MACHINE_ID.trim().length === 0) {
    throw new Error('RITO_READER_MACHINE_ID must name the memory gate machine');
  }
  return MACHINE_ID;
}

function attachJson(testInfo: TestInfo, name: string, value: unknown): Promise<void> {
  return testInfo.attach(`${basename(name, '.json')}.json`, {
    body: Buffer.from(JSON.stringify(value, null, 2)),
    contentType: 'application/json',
  });
}

function runSummary(report: ReaderMemoryGateReport) {
  const summarize = (checkpoint: ReaderMemoryGateReport['checkpoints']['baseline']) => ({
    physFootprintMiB: toMiB(checkpoint.selected.totalPhysFootprintBytes),
    stableRangeMiB: toMiB(checkpoint.stableRangeBytes),
    stableGrowthMiB: toMiB(checkpoint.stableGrowthBytes),
    rendererDiagnostics: checkpoint.selected.diagnostics,
  });
  return {
    checkpoints: {
      baseline: summarize(report.checkpoints.baseline),
      loaded: summarize(report.checkpoints.loaded),
      growth: summarize(report.checkpoints.growth),
      reflow: summarize(report.checkpoints.reflow),
      replacements: report.checkpoints.replacements.map(summarize),
      disposed: summarize(report.checkpoints.disposed),
    },
    workerLifecycle: report.workerLifecycle,
    metrics: report.metrics,
  };
}

function toMiB(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 1000) / 1000;
}
