#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  medianMetrics,
  previewAbDescriptiveMetrics,
  previewAbMetrics,
  ratioMetrics,
} from './reader-preview-ab-model.mjs';

const root = resolve(import.meta.dirname, '../../../..');
const appRoot = resolve(root, 'apps/reader');
const lockPath = '/tmp/rito-reader-preview-ab.lock';
const modePattern = ['enabled', 'disabled', 'disabled', 'enabled'];

if (process.env.RITO_MEMORY_GUARD_ACTIVE !== '1') {
  throw new Error('Reader preview A/B must run through the repository memory guard');
}

const args = parseArgs(process.argv.slice(2));
const outputDir = resolve(root, args.output);
requireWorkspaceOutput(outputDir);
await stat(resolve(appRoot, 'dist/index.html'));
const epubMetadata = await stat(args.epub);
if (!epubMetadata.isFile()) throw new Error('--epub must identify a regular file');
const playwrightCli = createRequire(resolve(root, 'package.json')).resolve('@playwright/test/cli');
const lock = await acquireLock();

try {
  await requireFreshDirectory(outputDir);
  const reports = [];
  const reportPaths = [];
  for (let order = 0; order < args.runs; order += 1) {
    const mode = modePattern[order % modePattern.length];
    const fileName = `${String(order).padStart(2, '0')}-${mode}.json`;
    const path = resolve(outputDir, 'reports', fileName);
    const playwrightOutput = resolve(outputDir, 'playwright', String(order).padStart(2, '0'));
    await runProfile({ mode, order, path, playwrightOutput });
    const report = JSON.parse(await readFile(path, 'utf8'));
    validateReport(report, { mode, order });
    reports.push(report);
    reportPaths.push(path);
  }
  await verifyRawReports(reports, reportPaths);
  const summary = buildSummary(reports);
  await writeFile(resolve(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} finally {
  await lock.close().catch(() => undefined);
  await rm(lockPath, { force: true }).catch(() => undefined);
}

async function runProfile({ mode, order, path, playwrightOutput }) {
  const child = spawn(
    process.execPath,
    [
      playwrightCli,
      'test',
      '-c',
      'playwright.config.ts',
      '--output',
      playwrightOutput,
      'tests/e2e/reader-load-profile.e2e.test.ts',
    ],
    {
      cwd: appRoot,
      env: {
        ...process.env,
        CI: '',
        RITO_READER_PROFILE_EPUB: args.epub,
        RITO_READER_MACHINE_ID: args.machineId,
        RITO_READER_PROFILE_AB_PAIR_ID: args.pairId,
        RITO_READER_PROFILE_AB_ORDER: String(order),
        RITO_READER_PROFILE_OUTPUT: path,
        RITO_READER_SKIP_E2E_BUILD: '1',
        RITO_READER_STRICT_SERVER: '1',
        RITO_READER_DISABLE_CHAPTER_LOCAL_PREVIEW: mode === 'disabled' ? '1' : '0',
        RITO_READER_HTML_REPORT: '0',
      },
      stdio: 'inherit',
    },
  );
  const result = await new Promise((resolveRun, rejectRun) => {
    child.once('error', rejectRun);
    child.once('close', (code, signal) => resolveRun({ code, signal }));
  });
  if (result.code !== 0) {
    throw new Error(
      `Reader preview A/B ${mode} order ${String(order)} failed (${String(result.code ?? result.signal)})`,
    );
  }
}

async function verifyRawReports(reports, paths) {
  for (const [index, path] of paths.entries()) {
    const persisted = JSON.parse(await readFile(path, 'utf8'));
    if (canonical(persisted) !== canonical(reports[index])) {
      throw new Error(`Reader preview A/B raw report ${String(index)} changed before summary`);
    }
  }
}

function validateReport(report, expected) {
  const environment = object(report.environment, 'environment');
  const execution = object(environment.execution, 'environment.execution');
  const artifact = object(environment.artifact, 'environment.artifact');
  const fixture = object(report.fixture, 'fixture');
  const transition = object(object(report.transitions, 'transitions').farToc, 'transitions.farToc');
  if (report.schemaVersion !== 5) throw new Error('Reader preview A/B report schema differs');
  equal(environment.chapterLocalPreviewMode, expected.mode, 'preview mode');
  equal(execution.abPairId, args.pairId, 'A/B pair id');
  equal(execution.abOrder, expected.order, 'A/B order');
  equal(execution.skippedE2eBuild, true, 'skip-build policy');
  equal(execution.strictServer, true, 'strict-server policy');
  requireSha256(artifact.readerDistSha256, 'reader dist');
  requireSha256(fixture.sha256, 'fixture');
  if (typeof transition.toHref !== 'string' || transition.toHref.length === 0) {
    throw new Error('Reader preview A/B report has no final TOC href');
  }
  if (typeof transition.checksumAfter !== 'string' || transition.checksumAfter.length === 0) {
    throw new Error('Reader preview A/B report has no final checksum');
  }
  for (const [name, value] of Object.entries(previewAbMetrics(report))) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`Reader preview A/B metric ${name} is invalid`);
    }
  }
  for (const [name, value] of Object.entries(previewAbDescriptiveMetrics(report))) {
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new Error(`Reader preview A/B descriptive metric ${name} is invalid`);
    }
  }
}

function buildSummary(reports) {
  const first = reports[0];
  for (const [index, report] of reports.entries()) {
    compareIdentity(first, report, index);
  }
  const pairs = [];
  for (let index = 0; index < reports.length; index += 2) {
    const pairReports = reports.slice(index, index + 2);
    const enabled = pairReports.find(
      (report) => report.environment.chapterLocalPreviewMode === 'enabled',
    );
    const disabled = pairReports.find(
      (report) => report.environment.chapterLocalPreviewMode === 'disabled',
    );
    if (!enabled || !disabled) throw new Error('Reader preview A/B pair lacks one mode');
    pairs.push({
      pairIndex: index / 2,
      orders: pairReports.map((report) => report.environment.execution.abOrder),
      enabled: previewAbMetrics(enabled),
      disabled: previewAbMetrics(disabled),
      disabledDivEnabled: ratioMetrics(previewAbMetrics(disabled), previewAbMetrics(enabled)),
      descriptive: {
        enabled: previewAbDescriptiveMetrics(enabled),
        disabled: previewAbDescriptiveMetrics(disabled),
      },
    });
  }
  return {
    schemaVersion: 1,
    id: 'rito/reader-preview-ab-v1',
    pairId: args.pairId,
    generatedAt: new Date().toISOString(),
    artifact: first.environment.artifact,
    fixture: first.fixture,
    browser: {
      name: first.environment.browserName,
      version: first.environment.browserVersion,
      policy: first.startup.browser,
    },
    viewport: first.environment.viewport,
    reflowViewport: first.environment.reflowViewport,
    runCount: reports.length,
    ratioInterpretation:
      'disabledDivEnabled compares common response and convergence metrics; values above 1 favor preview. Animation quality is descriptive because the exact-only control is intentionally atomic. A null ratio means the enabled denominator was zero, so no ratio is claimed.',
    pairs,
    medians: {
      enabled: medianMetrics(pairs.map((pair) => pair.enabled)),
      disabled: medianMetrics(pairs.map((pair) => pair.disabled)),
      disabledDivEnabled: medianMetrics(pairs.map((pair) => pair.disabledDivEnabled)),
      descriptive: {
        enabled: medianMetrics(pairs.map((pair) => pair.descriptive.enabled)),
        disabled: medianMetrics(pairs.map((pair) => pair.descriptive.disabled)),
      },
    },
    rawReports: reports.map((report) => ({
      order: report.environment.execution.abOrder,
      mode: report.environment.chapterLocalPreviewMode,
      generatedAt: report.generatedAt,
      path: `reports/${String(report.environment.execution.abOrder).padStart(2, '0')}-${report.environment.chapterLocalPreviewMode}.json`,
    })),
  };
}

function compareIdentity(expected, actual, index) {
  const fields = [
    ['artifact', expected.environment.artifact, actual.environment.artifact],
    ['fixture', expected.fixture, actual.fixture],
    ['browser name', expected.environment.browserName, actual.environment.browserName],
    ['browser version', expected.environment.browserVersion, actual.environment.browserVersion],
    ['browser policy', expected.startup.browser, actual.startup.browser],
    ['DPR', expected.environment.deviceScaleFactor, actual.environment.deviceScaleFactor],
    ['viewport', expected.environment.viewport, actual.environment.viewport],
    ['reflow viewport', expected.environment.reflowViewport, actual.environment.reflowViewport],
    ['far TOC target', expected.transitions.farToc.toHref, actual.transitions.farToc.toHref],
    ['far TOC start', expected.transitions.farToc.fromHref, actual.transitions.farToc.fromHref],
    [
      'far TOC starting checksum',
      expected.transitions.farToc.checksumBefore,
      actual.transitions.farToc.checksumBefore,
    ],
    [
      'far TOC final checksum',
      expected.transitions.farToc.checksumAfter,
      actual.transitions.farToc.checksumAfter,
    ],
  ];
  for (const [label, left, right] of fields) {
    if (canonical(left) !== canonical(right)) {
      throw new Error(`Reader preview A/B run ${String(index)} ${label} differs`);
    }
  }
}

function parseArgs(values) {
  const parsed = new Map();
  const allowed = new Set(['epub', 'output', 'runs', 'pair-id', 'machine-id']);
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith('--') || value === undefined) throw new Error('Use --name value args');
    const key = name.slice(2);
    if (!allowed.has(key)) throw new Error(`Unknown argument: --${key}`);
    if (parsed.has(key)) throw new Error(`Duplicate argument: --${key}`);
    parsed.set(key, value);
  }
  for (const name of ['epub', 'output']) {
    if (!parsed.has(name)) throw new Error(`--${name} is required`);
  }
  const configuredEpub = parsed.get('epub');
  if (!isAbsolute(configuredEpub)) throw new Error('--epub must be absolute');
  const epub = resolve(configuredEpub);
  const runs = Number(parsed.get('runs') ?? 4);
  if (!Number.isSafeInteger(runs) || runs < 4 || runs > 8 || runs % 4 !== 0) {
    throw new Error('--runs must be 4 or 8 so every sample is a complete ABBA block');
  }
  return {
    epub,
    output: parsed.get('output'),
    runs,
    pairId: parsed.get('pair-id') ?? `preview-ab-${Date.now().toString(36)}`,
    machineId: parsed.get('machine-id') ?? 'report-only',
  };
}

function requireWorkspaceOutput(path) {
  if (path === root || !path.startsWith(`${root}${sep}`)) {
    throw new Error('--output must be a fresh directory inside the repository');
  }
}

async function requireFreshDirectory(path) {
  try {
    await stat(path);
    throw new Error(`Reader preview A/B output already exists: ${relative(root, path)}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await mkdir(dirname(path), { recursive: true });
  await mkdir(path);
}

async function acquireLock() {
  try {
    const handle = await open(lockPath, 'wx');
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, pairId: args.pairId })}\n`);
    return handle;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    throw new Error(
      `Reader preview A/B lock already exists at ${lockPath}; fail closed until its owner is verified externally`,
      { cause: error },
    );
  }
}

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Reader preview A/B ${name} is invalid`);
  }
  return value;
}

function equal(actual, expected, name) {
  if (actual !== expected) throw new Error(`Reader preview A/B ${name} differs`);
}

function requireSha256(value, name) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`Reader preview A/B ${name} SHA-256 is invalid`);
  }
}

function canonical(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(value[key])]),
  );
}
