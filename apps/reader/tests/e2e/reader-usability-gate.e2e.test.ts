import { expect, test, type Browser, type TestInfo } from '@playwright/test';
import { basename } from 'node:path';
import type { ReaderLoadProfileReport } from './reader-profile-model';
import { runReaderLoadProfile } from './reader-profile-runner';
import {
  evaluateReaderUsabilityCase,
  loadReaderUsabilityGate,
  requireReaderUsabilityEnvironment,
  type ReaderUsabilityCaseSummary,
  type ReaderUsabilityGate,
  type ReaderUsabilityGateCase,
} from './reader-usability-gate';
import { installReaderWorkerProbe } from './reader-worker-probe';

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

  test('meets every corpus and stage threshold', async ({ browser }, testInfo) => {
    const gate = await loadConfiguredGate();
    const machineId = requireMachineId();
    test.setTimeout(gate.runs * gate.cases.length * RUN_TIMEOUT_MS + 30_000);
    const summaries: ReaderUsabilityCaseSummary[] = [];

    for (const caseConfig of gate.cases) {
      const reports = await runCase(browser, gate, caseConfig, machineId, testInfo);
      summaries.push(evaluateReaderUsabilityCase(caseConfig, reports, gate.runs));
    }

    await attachJson(testInfo, 'reader-usability-gate-summary', {
      schemaVersion: gate.schemaVersion,
      machine: gate.machine,
      deviceScaleFactor: gate.deviceScaleFactor,
      viewport: gate.viewport,
      reflowViewport: gate.reflowViewport,
      summaries,
    });
    console.log(`Rito reader usability gate\n${JSON.stringify(summaries, null, 2)}`);
  });
});

async function runCase(
  browser: Browser,
  gate: ReaderUsabilityGate,
  caseConfig: ReaderUsabilityGateCase,
  machineId: string,
  testInfo: TestInfo,
): Promise<ReaderLoadProfileReport[]> {
  const reports: ReaderLoadProfileReport[] = [];
  for (let run = 1; run <= gate.runs; run += 1) {
    const context = await browser.newContext({
      viewport: gate.viewport,
      deviceScaleFactor: gate.deviceScaleFactor,
    });
    try {
      await installReaderWorkerProbe(context);
      const page = await context.newPage();
      const report = await runReaderLoadProfile(page, browser, {
        fixtureId: caseConfig.id,
        epubPath: caseConfig.epub,
        machineId,
        viewport: gate.viewport,
        reflowViewport: gate.reflowViewport,
      });
      requireReaderUsabilityEnvironment(gate, report.environment, MACHINE_ID);
      expect(report.browserErrors, report.browserErrors.join('\n')).toEqual([]);
      await attachJson(testInfo, `${caseConfig.id}-run-${String(run)}`, report);
      reports.push(report);
    } finally {
      await context.close();
    }
  }
  return reports;
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
