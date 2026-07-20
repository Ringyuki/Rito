import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { ReaderProfileViewport } from './reader-profile-model';
import {
  mapReaderUsabilityMetrics,
  READER_USABILITY_METRIC_KEYS,
} from './reader-usability-metrics';
import {
  READER_USABILITY_GATE_SCHEMA_VERSION,
  READER_USABILITY_MACHINE_KEYS,
  type ReaderUsabilityGate,
  type ReaderUsabilityGateBrowser,
  type ReaderUsabilityGateCase,
  type ReaderUsabilityGateMachine,
  type ReaderUsabilityPinnedFont,
  type ReaderUsabilityThresholds,
} from './reader-usability-gate-types';
import {
  boundedInteger,
  exactRecord,
  invalid,
  nonEmptyArray,
  nonEmptyText,
  parseJson,
  positiveFinite,
} from './reader-usability-gate-validation';

const ROOT_KEYS = [
  'schemaVersion',
  'machine',
  'browser',
  'pinnedFonts',
  'deviceScaleFactor',
  'viewport',
  'reflowViewport',
  'runs',
  'cases',
] as const;
const BROWSER_KEYS = ['isolation', 'channel', 'headless', 'locale', 'colorScheme'] as const;
const PINNED_FONT_KEYS = ['sha256', 'byteLength', 'genericRole', 'language'] as const;
const VIEWPORT_KEYS = ['width', 'height'] as const;

export async function loadReaderUsabilityGate(path: string): Promise<ReaderUsabilityGate> {
  const manifestPath = resolve(path);
  const root = exactRecord(
    parseJson(await readFile(manifestPath, 'utf8'), manifestPath),
    ROOT_KEYS,
    'manifest',
  );
  if (root.schemaVersion !== READER_USABILITY_GATE_SCHEMA_VERSION) {
    throw invalid('manifest.schemaVersion', 'must equal 4');
  }
  return {
    schemaVersion: READER_USABILITY_GATE_SCHEMA_VERSION,
    machine: parseMachine(root.machine),
    browser: parseBrowser(root.browser),
    pinnedFonts: parsePinnedFonts(root.pinnedFonts),
    deviceScaleFactor: positiveFinite(root.deviceScaleFactor, 'manifest.deviceScaleFactor'),
    viewport: parseViewport(root.viewport, 'manifest.viewport'),
    reflowViewport: parseViewport(root.reflowViewport, 'manifest.reflowViewport'),
    runs: boundedInteger(root.runs, 'manifest.runs', 1, 10),
    cases: await parseCases(root.cases, dirname(manifestPath)),
  };
}

async function parseCases(value: unknown, directory: string): Promise<ReaderUsabilityGateCase[]> {
  const cases: ReaderUsabilityGateCase[] = [];
  const ids = new Set<string>();
  for (const [index, entry] of nonEmptyArray(value, 'manifest.cases').entries()) {
    const parsed = await parseCase(entry, directory, index);
    if (ids.has(parsed.id)) throw invalid('manifest.cases', `duplicate id "${parsed.id}"`);
    ids.add(parsed.id);
    cases.push(parsed);
  }
  return cases;
}

async function parseCase(
  value: unknown,
  manifestDirectory: string,
  index: number,
): Promise<ReaderUsabilityGateCase> {
  const path = `manifest.cases[${String(index)}]`;
  const record = exactRecord(value, ['id', 'epub', 'sha256', 'thresholds'], path);
  const epub = resolve(manifestDirectory, nonEmptyText(record.epub, `${path}.epub`));
  const epubStat = await stat(epub).catch(() => undefined);
  if (!epubStat?.isFile()) throw invalid(`${path}.epub`, `must identify a file: ${epub}`);
  return {
    id: nonEmptyText(record.id, `${path}.id`),
    epub,
    sha256: sha256(record.sha256, `${path}.sha256`),
    thresholds: parseThresholds(record.thresholds, `${path}.thresholds`),
  };
}

function parseMachine(value: unknown): ReaderUsabilityGateMachine {
  const record = exactRecord(value, READER_USABILITY_MACHINE_KEYS, 'manifest.machine');
  return {
    id: nonEmptyText(record.id, 'manifest.machine.id'),
    platform: nonEmptyText(record.platform, 'manifest.machine.platform'),
    arch: nonEmptyText(record.arch, 'manifest.machine.arch'),
    cpuModel: nonEmptyText(record.cpuModel, 'manifest.machine.cpuModel'),
    osRelease: nonEmptyText(record.osRelease, 'manifest.machine.osRelease'),
    browserName: nonEmptyText(record.browserName, 'manifest.machine.browserName'),
    browserVersion: nonEmptyText(record.browserVersion, 'manifest.machine.browserVersion'),
  };
}

function parseBrowser(value: unknown): ReaderUsabilityGateBrowser {
  const record = exactRecord(value, BROWSER_KEYS, 'manifest.browser');
  if (record.isolation !== 'process-per-run') {
    throw invalid('manifest.browser.isolation', 'must equal "process-per-run"');
  }
  if (record.channel !== 'bundled') {
    throw invalid('manifest.browser.channel', 'must equal "bundled"');
  }
  if (record.headless !== true) throw invalid('manifest.browser.headless', 'must equal true');
  const colorScheme = record.colorScheme;
  if (colorScheme !== 'light' && colorScheme !== 'dark') {
    throw invalid('manifest.browser.colorScheme', 'must equal "light" or "dark"');
  }
  return {
    isolation: record.isolation,
    channel: record.channel,
    headless: record.headless,
    locale: nonEmptyText(record.locale, 'manifest.browser.locale'),
    colorScheme,
  };
}

function parsePinnedFonts(value: unknown): ReaderUsabilityPinnedFont[] {
  const fonts = nonEmptyArray(value, 'manifest.pinnedFonts').map((entry, index) =>
    parsePinnedFont(entry, index),
  );
  const hashes = new Set(fonts.map((font) => font.sha256));
  if (hashes.size !== fonts.length) throw invalid('manifest.pinnedFonts', 'contains duplicate SHA');
  return fonts;
}

function parsePinnedFont(value: unknown, index: number): ReaderUsabilityPinnedFont {
  const path = `manifest.pinnedFonts[${String(index)}]`;
  const record = exactRecord(value, PINNED_FONT_KEYS, path);
  const language = nonEmptyText(record.language, `${path}.language`);
  if (language !== language.toLowerCase()) {
    throw invalid(`${path}.language`, 'must be lowercase');
  }
  return {
    sha256: sha256(record.sha256, `${path}.sha256`),
    byteLength: boundedInteger(record.byteLength, `${path}.byteLength`, 1),
    genericRole: nonEmptyText(record.genericRole, `${path}.genericRole`),
    language,
  };
}

function parseViewport(value: unknown, path: string): ReaderProfileViewport {
  const record = exactRecord(value, VIEWPORT_KEYS, path);
  return {
    width: boundedInteger(record.width, `${path}.width`, 1),
    height: boundedInteger(record.height, `${path}.height`, 1),
  };
}

function parseThresholds(value: unknown, path: string): ReaderUsabilityThresholds {
  const record = exactRecord(value, READER_USABILITY_METRIC_KEYS, path);
  return mapReaderUsabilityMetrics((key) =>
    key === 'farTocWorkerRequestsToFirstFrame'
      ? boundedInteger(record[key], `${path}.${key}`, 1)
      : positiveFinite(record[key], `${path}.${key}`),
  );
}

function sha256(value: unknown, path: string): string {
  const hash = nonEmptyText(value, path);
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw invalid(path, 'must be 64 lowercase hexadecimal characters');
  }
  return hash;
}
