import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ReaderUsabilityMetrics } from './reader-profile-model';
import {
  evaluateReaderUsabilityCase,
  loadReaderUsabilityGate,
  requireReaderUsabilityEnvironment,
  type ReaderUsabilityGateCase,
} from './reader-usability-gate';
import {
  READER_GATE_TEST_ENVIRONMENT as ENVIRONMENT,
  READER_GATE_TEST_SHA256 as SHA256,
  readerGateTestMetrics as metrics,
  readerGateTestProfile as profile,
} from './reader-usability-gate-test-data';

const METRIC_KEYS = [
  'openRoundTripMs',
  'boundedToPresentationMs',
  'frameWarmRoundTripMs',
  'canvasReadyMs',
  'cachedTurnFirstFrameMs',
  'deferredGrowthFirstFrameMs',
  'reflowFirstFrameMs',
  'maxLongTaskMs',
] as const satisfies readonly (keyof ReaderUsabilityMetrics)[];
let directory = '';

test.beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'rito-usability-gate-'));
  await writeFile(join(directory, 'fixture.epub'), 'epub');
});

test.afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

test('strictly parses a manifest and resolves EPUB paths from its directory', async () => {
  const path = await writeManifest(validManifest());
  const gate = await loadReaderUsabilityGate(path);

  expect(gate.schemaVersion).toBe(1);
  expect(gate.runs).toBe(3);
  expect(gate.cases).toHaveLength(1);
  expect(gate.cases[0]?.epub).toBe(resolve(directory, 'fixture.epub'));
  expect(gate.cases[0]?.sha256).toBe(SHA256);
});

test('rejects unknown and missing fields at every schema layer', async () => {
  const mutations: readonly ((manifest: GateJson) => void)[] = [
    (manifest) => delete manifest['runs'],
    (manifest) => delete manifest['deviceScaleFactor'],
    (manifest) => (manifest['extra'] = true),
    (manifest) => delete record(manifest['machine'])['arch'],
    (manifest) => (record(manifest['machine'])['extra'] = true),
    (manifest) => delete record(manifest['viewport'])['height'],
    (manifest) => (record(manifest['reflowViewport'])['extra'] = true),
    (manifest) => delete firstCase(manifest)['sha256'],
    (manifest) => (firstCase(manifest)['extra'] = true),
    (manifest) => delete record(firstCase(manifest)['thresholds'])['reflowFirstFrameMs'],
    (manifest) => (record(firstCase(manifest)['thresholds'])['extra'] = true),
  ];

  for (const [index, mutate] of mutations.entries()) {
    const manifest = validManifest();
    mutate(manifest);
    await expect(loadReaderUsabilityGate(await writeManifest(manifest, index))).rejects.toThrow(
      /Invalid reader usability gate/,
    );
  }
});

test('rejects invalid runs, threshold values, duplicate ids, and SHA-256 shape', async () => {
  const invalidManifests: GateJson[] = [];
  for (const runs of [0, 11, 1.5]) invalidManifests.push({ ...validManifest(), runs });
  invalidManifests.push({ ...validManifest(), deviceScaleFactor: 0 });

  const badThreshold = validManifest();
  record(firstCase(badThreshold)['thresholds'])['cachedTurnFirstFrameMs'] = 0;
  invalidManifests.push(badThreshold);

  const uppercaseHash = validManifest();
  firstCase(uppercaseHash)['sha256'] = 'A'.repeat(64);
  invalidManifests.push(uppercaseHash);

  const duplicate = validManifest();
  duplicate['cases'] = [firstCase(duplicate), structuredClone(firstCase(duplicate))];
  invalidManifests.push(duplicate);

  for (const [index, manifest] of invalidManifests.entries()) {
    await expect(loadReaderUsabilityGate(await writeManifest(manifest, index))).rejects.toThrow();
  }
});

test('rejects missing EPUBs and directories in place of EPUB files', async () => {
  const missing = validManifest();
  firstCase(missing)['epub'] = './missing.epub';
  await expect(loadReaderUsabilityGate(await writeManifest(missing, 1))).rejects.toThrow(
    /must identify a file/,
  );

  const directoryFixture = validManifest();
  firstCase(directoryFixture)['epub'] = '.';
  await expect(loadReaderUsabilityGate(await writeManifest(directoryFixture, 2))).rejects.toThrow(
    /must identify a file/,
  );
});

test('requires the supplied machine identity and full measured environment', async () => {
  const gate = await loadReaderUsabilityGate(await writeManifest(validManifest()));
  expect(requireReaderUsabilityEnvironment(gate, ENVIRONMENT, 'local-m3')).toBe(ENVIRONMENT);

  expect(() => requireReaderUsabilityEnvironment(gate, ENVIRONMENT, 'other')).toThrow(
    /supplied machine id/,
  );
  expect(() =>
    requireReaderUsabilityEnvironment(
      gate,
      {
        ...ENVIRONMENT,
        browserVersion: '141.0.0.0',
        deviceScaleFactor: 1.5,
        viewport: { width: 1, height: 2 },
      },
      'local-m3',
    ),
  ).toThrow(/browserVersion.*deviceScaleFactor.*viewport.width.*viewport.height/s);
});

test('reports every exceeded p95 threshold in one error', () => {
  const caseConfig = evaluationCase(0.5);
  const reports = [profile(1), profile(2), profile(3)];

  let failure: unknown;
  try {
    evaluateReaderUsabilityCase(caseConfig, reports, 3);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  for (const key of METRIC_KEYS) expect((failure as Error).message).toContain(key);
});

test('uses nearest-rank p95 and returns a serializable passing summary', () => {
  const caseConfig = evaluationCase(10);
  const summary = evaluateReaderUsabilityCase(caseConfig, [profile(1), profile(7), profile(3)], 3);

  expect(summary.p95).toEqual(metrics(7));
  expect(summary.thresholds).toEqual(metrics(10));
  expect(summary.runs).toBe(3);
  expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
});

test('limits long-task thresholds to measured action windows', () => {
  const report = {
    ...profile(1),
    longTasks: { count: 1, totalMs: 999, maxMs: 999 },
  };
  expect(evaluateReaderUsabilityCase(evaluationCase(10), [report], 1).p95.maxLongTaskMs).toBe(1);
});

test('rejects run count, fixture identity, SHA, and environment inconsistencies', () => {
  const caseConfig = evaluationCase(10);
  expect(() => evaluateReaderUsabilityCase(caseConfig, [profile(1)], 2)).toThrow(
    /expected 2 reports/,
  );
  expect(() =>
    evaluateReaderUsabilityCase(caseConfig, [profile(1, { fixtureId: 'other' })], 1),
  ).toThrow(/fixture identity mismatch/);
  expect(() =>
    evaluateReaderUsabilityCase(caseConfig, [profile(1, { sha256: 'b'.repeat(64) })], 1),
  ).toThrow(/fixture identity mismatch/);
  expect(() =>
    evaluateReaderUsabilityCase(
      caseConfig,
      [profile(1), profile(1, { environment: { ...ENVIRONMENT, arch: 'x64' } })],
      2,
    ),
  ).toThrow(/environment mismatch/);
});

type GateJson = Record<string, unknown>;

function validManifest(): GateJson {
  return {
    schemaVersion: 1,
    machine: {
      id: ENVIRONMENT.machineId,
      platform: ENVIRONMENT.platform,
      arch: ENVIRONMENT.arch,
      cpuModel: ENVIRONMENT.cpuModel,
      osRelease: ENVIRONMENT.osRelease,
      browserName: ENVIRONMENT.browserName,
      browserVersion: ENVIRONMENT.browserVersion,
    },
    deviceScaleFactor: ENVIRONMENT.deviceScaleFactor,
    viewport: { ...ENVIRONMENT.viewport },
    reflowViewport: { ...ENVIRONMENT.reflowViewport },
    runs: 3,
    cases: [{ id: 'fixture', epub: './fixture.epub', sha256: SHA256, thresholds: metrics(10) }],
  };
}

async function writeManifest(manifest: GateJson, suffix = 0): Promise<string> {
  const path = join(directory, `gate-${String(suffix)}.json`);
  await writeFile(path, JSON.stringify(manifest));
  return path;
}

function firstCase(manifest: GateJson): Record<string, unknown> {
  const cases = manifest['cases'];
  if (!Array.isArray(cases) || cases.length === 0) throw new Error('test manifest has no case');
  return record(cases[0]);
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('test value is not a record');
  }
  return value as Record<string, unknown>;
}

function evaluationCase(threshold: number): ReaderUsabilityGateCase {
  return { id: 'fixture', epub: '/fixture.epub', sha256: SHA256, thresholds: metrics(threshold) };
}
