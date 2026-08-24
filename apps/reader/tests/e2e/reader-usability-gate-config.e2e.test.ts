import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { READER_USABILITY_METRIC_KEYS as METRIC_KEYS } from './reader-usability-metrics';
import {
  evaluateReaderUsabilityCase,
  loadReaderUsabilityGate,
  requireReaderUsabilityBrowserPolicy,
  requireReaderUsabilityEnvironment,
  type ReaderUsabilityGateCase,
} from './reader-usability-gate';
import {
  READER_GATE_TEST_ENVIRONMENT as ENVIRONMENT,
  READER_GATE_TEST_SHA256 as SHA256,
  readerGateTestManifest as validManifest,
  readerGateTestMetrics as metrics,
  readerGateTestProfile as profile,
  type ReaderGateTestJson as GateJson,
} from './reader-usability-gate-test-data';

let directory = '';
const PRODUCTION_M3_GATE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'reader-usability-gates/ringyuki-macbook-air-m3.json',
);

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

  expect(gate.schemaVersion).toBe(4);
  expect(gate.runs).toBe(3);
  expect(gate.browser.isolation).toBe('process-per-run');
  expect(gate.pinnedFonts).toHaveLength(2);
  expect(gate.cases).toHaveLength(1);
  expect(gate.cases[0]?.epub).toBe(resolve(directory, 'fixture.epub'));
  expect(gate.cases[0]?.sha256).toBe(SHA256);
});

test('locks the production M3 TOC latency and request thresholds', async () => {
  const gate = await loadReaderUsabilityGate(PRODUCTION_M3_GATE);
  expect(
    gate.cases.map((entry) => ({
      id: entry.id,
      tocSupersedeFirstFrameMs: entry.thresholds.tocSupersedeFirstFrameMs,
      farTocFirstFrameMs: entry.thresholds.farTocFirstFrameMs,
      farTocWorkerRequestsToFirstFrame: entry.thresholds.farTocWorkerRequestsToFirstFrame,
    })),
  ).toEqual([
    {
      id: 'book-01',
      tocSupersedeFirstFrameMs: 75,
      farTocFirstFrameMs: 150,
      farTocWorkerRequestsToFirstFrame: 16,
    },
    {
      id: 'book-04',
      tocSupersedeFirstFrameMs: 75,
      farTocFirstFrameMs: 150,
      farTocWorkerRequestsToFirstFrame: 16,
    },
    {
      id: 'book-10',
      tocSupersedeFirstFrameMs: 75,
      farTocFirstFrameMs: 150,
      farTocWorkerRequestsToFirstFrame: 16,
    },
  ]);
});

test('rejects unknown and missing fields at every schema layer', async () => {
  const mutations: readonly ((manifest: GateJson) => void)[] = [
    (manifest) => delete manifest['runs'],
    (manifest) => delete manifest['deviceScaleFactor'],
    (manifest) => (manifest['extra'] = true),
    (manifest) => delete record(manifest['machine'])['arch'],
    (manifest) => (record(manifest['machine'])['extra'] = true),
    (manifest) => delete record(manifest['browser'])['locale'],
    (manifest) => (record(manifest['browser'])['extra'] = true),
    (manifest) => delete record(firstPinnedFont(manifest))['byteLength'],
    (manifest) => (record(firstPinnedFont(manifest))['extra'] = true),
    (manifest) => delete record(manifest['viewport'])['height'],
    (manifest) => (record(manifest['reflowViewport'])['extra'] = true),
    (manifest) => delete firstCase(manifest)['sha256'],
    (manifest) => (firstCase(manifest)['extra'] = true),
    (manifest) => delete record(firstCase(manifest)['thresholds'])['reflowFirstFrameMs'],
    (manifest) =>
      delete record(firstCase(manifest)['thresholds'])['farTocWorkerRequestsToFirstFrame'],
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

test('rejects v3 manifests and a missing cached-turn stability threshold', async () => {
  const oldSchema = validManifest();
  oldSchema['schemaVersion'] = 3;
  await expect(loadReaderUsabilityGate(await writeManifest(oldSchema, 1))).rejects.toThrow(
    /manifest\.schemaVersion: must equal 4/,
  );

  const missingStableThreshold = validManifest();
  delete record(firstCase(missingStableThreshold)['thresholds'])['cachedTurnStableMs'];
  await expect(
    loadReaderUsabilityGate(await writeManifest(missingStableThreshold, 2)),
  ).rejects.toThrow(/missing cachedTurnStableMs/);
});

test('rejects invalid runs, threshold values, duplicate ids, and SHA-256 shape', async () => {
  const invalidManifests: GateJson[] = [];
  for (const runs of [0, 11, 1.5]) invalidManifests.push({ ...validManifest(), runs });
  invalidManifests.push({ ...validManifest(), deviceScaleFactor: 0 });

  for (const [key, value] of [
    ['isolation', 'shared-process'],
    ['channel', 'msedge'],
    ['headless', false],
    ['colorScheme', 'sepia'],
  ] as const) {
    const invalidBrowser = validManifest();
    record(invalidBrowser['browser'])[key] = value;
    invalidManifests.push(invalidBrowser);
  }

  const duplicateFont = validManifest();
  duplicateFont['pinnedFonts'] = [
    firstPinnedFont(duplicateFont),
    structuredClone(firstPinnedFont(duplicateFont)),
  ];
  invalidManifests.push(duplicateFont);

  const uppercaseFontHash = validManifest();
  firstPinnedFont(uppercaseFontHash)['sha256'] = 'A'.repeat(64);
  invalidManifests.push(uppercaseFontHash);

  const badThreshold = validManifest();
  record(firstCase(badThreshold)['thresholds'])['cachedTurnFirstFrameMs'] = 0;
  invalidManifests.push(badThreshold);

  const badStableThreshold = validManifest();
  record(firstCase(badStableThreshold)['thresholds'])['cachedTurnStableMs'] = 0;
  invalidManifests.push(badStableThreshold);

  const fractionalRequestThreshold = validManifest();
  record(firstCase(fractionalRequestThreshold)['thresholds'])['farTocWorkerRequestsToFirstFrame'] =
    1.5;
  invalidManifests.push(fractionalRequestThreshold);

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

test('requires the measured isolated browser policy', async () => {
  const gate = await loadReaderUsabilityGate(await writeManifest(validManifest()));
  expect(requireReaderUsabilityBrowserPolicy(gate, profile(1).startup.browser)).toEqual(
    profile(1).startup.browser,
  );
  expect(() =>
    requireReaderUsabilityBrowserPolicy(gate, {
      ...profile(1).startup.browser,
      isolation: 'shared-process',
      locale: 'ja-JP',
    }),
  ).toThrow(/browser.isolation.*browser.locale/s);
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
  expect(() =>
    evaluateReaderUsabilityCase(
      evaluationCase(10),
      [
        profile(1),
        {
          ...profile(1),
          startup: {
            ...profile(1).startup,
            browser: { ...profile(1).startup.browser, locale: 'ja-JP' },
          },
        },
      ],
      2,
    ),
  ).toThrow(/browser policy mismatch/);
});

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

function firstPinnedFont(manifest: GateJson): Record<string, unknown> {
  const fonts = manifest['pinnedFonts'];
  if (!Array.isArray(fonts) || fonts.length === 0) throw new Error('test manifest has no fonts');
  return record(fonts[0]);
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
