import { stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  READER_MEMORY_GATE_SCHEMA_VERSION,
  READER_MEMORY_METRIC_KEYS,
  type ReaderMemoryBrowserPolicy,
  type ReaderMemoryFixture,
  type ReaderMemoryGate,
  type ReaderMemoryMachine,
  type ReaderMemoryPinnedFont,
  type ReaderMemoryScenario,
  type ReaderMemoryThresholds,
  type ReaderMemoryViewport,
} from './memory-gate-types';
import {
  exactMemoryRecord,
  invalidMemory,
  memoryFinite,
  memoryInteger,
  memorySha256,
  memoryText,
  nonEmptyMemoryArray,
  parseMemoryJson,
} from './memory-gate-validation';

const ROOT_KEYS = [
  'schemaVersion',
  'machine',
  'browser',
  'pinnedFonts',
  'deviceScaleFactor',
  'viewport',
  'reflowViewport',
  'runs',
  'fixture',
  'scenario',
  'thresholds',
] as const;
const MACHINE_KEYS = [
  'id',
  'platform',
  'arch',
  'cpuModel',
  'osRelease',
  'browserName',
  'browserVersion',
] as const;
const BROWSER_KEYS = ['isolation', 'channel', 'headless', 'locale', 'colorScheme'] as const;
const PINNED_FONT_KEYS = ['sha256', 'byteLength', 'genericRole', 'language'] as const;
const VIEWPORT_KEYS = ['width', 'height'] as const;
const FIXTURE_KEYS = ['id', 'epub', 'sha256'] as const;
const SCENARIO_KEYS = ['replacementRounds', 'stabilization'] as const;
const STABILIZATION_KEYS = [
  'sampleIntervalMs',
  'minSamples',
  'maxSamples',
  'maxSampleRangeMiB',
  'maxSampleGrowthMiB',
] as const;

export async function loadReaderMemoryGate(path: string): Promise<ReaderMemoryGate> {
  const manifestPath = resolve(path);
  const root = exactMemoryRecord(
    parseMemoryJson(await readFile(manifestPath, 'utf8'), `manifest at ${manifestPath}`),
    ROOT_KEYS,
    'manifest',
  );
  if (root.schemaVersion !== READER_MEMORY_GATE_SCHEMA_VERSION) {
    throw invalidMemory(
      'manifest.schemaVersion',
      `must equal ${String(READER_MEMORY_GATE_SCHEMA_VERSION)}`,
    );
  }
  const viewport = parseViewport(root.viewport, 'manifest.viewport');
  const reflowViewport = parseViewport(root.reflowViewport, 'manifest.reflowViewport');
  if (viewport.width === reflowViewport.width && viewport.height === reflowViewport.height) {
    throw invalidMemory('manifest.reflowViewport', 'must differ from manifest.viewport');
  }
  return {
    schemaVersion: READER_MEMORY_GATE_SCHEMA_VERSION,
    machine: parseMachine(root.machine),
    browser: parseBrowser(root.browser),
    pinnedFonts: parsePinnedFonts(root.pinnedFonts),
    deviceScaleFactor: memoryFinite(root.deviceScaleFactor, 'manifest.deviceScaleFactor', 0.1),
    viewport,
    reflowViewport,
    runs: memoryInteger(root.runs, 'manifest.runs', 3, 5),
    fixture: await parseFixture(root.fixture, dirname(manifestPath)),
    scenario: parseScenario(root.scenario),
    thresholds: parseThresholds(root.thresholds),
  };
}

function parseMachine(value: unknown): ReaderMemoryMachine {
  const record = exactMemoryRecord(value, MACHINE_KEYS, 'manifest.machine');
  if (record.platform !== 'darwin') {
    throw invalidMemory('manifest.machine.platform', 'must equal "darwin"');
  }
  if (record.browserName !== 'chromium') {
    throw invalidMemory('manifest.machine.browserName', 'must equal "chromium"');
  }
  return {
    id: memoryText(record.id, 'manifest.machine.id'),
    platform: record.platform,
    arch: memoryText(record.arch, 'manifest.machine.arch'),
    cpuModel: memoryText(record.cpuModel, 'manifest.machine.cpuModel'),
    osRelease: memoryText(record.osRelease, 'manifest.machine.osRelease'),
    browserName: record.browserName,
    browserVersion: memoryText(record.browserVersion, 'manifest.machine.browserVersion'),
  };
}

function parseBrowser(value: unknown): ReaderMemoryBrowserPolicy {
  const record = exactMemoryRecord(value, BROWSER_KEYS, 'manifest.browser');
  if (record.isolation !== 'process-per-run') {
    throw invalidMemory('manifest.browser.isolation', 'must equal "process-per-run"');
  }
  if (record.channel !== 'bundled') {
    throw invalidMemory('manifest.browser.channel', 'must equal "bundled"');
  }
  if (record.headless !== true) {
    throw invalidMemory('manifest.browser.headless', 'must equal true');
  }
  if (record.colorScheme !== 'light' && record.colorScheme !== 'dark') {
    throw invalidMemory('manifest.browser.colorScheme', 'must equal "light" or "dark"');
  }
  return {
    isolation: record.isolation,
    channel: record.channel,
    headless: record.headless,
    locale: memoryText(record.locale, 'manifest.browser.locale'),
    colorScheme: record.colorScheme,
  };
}

function parsePinnedFonts(value: unknown): ReaderMemoryPinnedFont[] {
  const fonts = nonEmptyMemoryArray(value, 'manifest.pinnedFonts').map((entry, index) => {
    const path = `manifest.pinnedFonts[${String(index)}]`;
    const record = exactMemoryRecord(entry, PINNED_FONT_KEYS, path);
    const language = memoryText(record.language, `${path}.language`);
    if (language !== language.toLowerCase()) {
      throw invalidMemory(`${path}.language`, 'must be lowercase');
    }
    return {
      sha256: memorySha256(record.sha256, `${path}.sha256`),
      byteLength: memoryInteger(record.byteLength, `${path}.byteLength`, 1),
      genericRole: memoryText(record.genericRole, `${path}.genericRole`),
      language,
    };
  });
  if (new Set(fonts.map((font) => font.sha256)).size !== fonts.length) {
    throw invalidMemory('manifest.pinnedFonts', 'contains duplicate SHA-256 values');
  }
  return fonts;
}

function parseViewport(value: unknown, path: string): ReaderMemoryViewport {
  const record = exactMemoryRecord(value, VIEWPORT_KEYS, path);
  return {
    width: memoryInteger(record.width, `${path}.width`, 1),
    height: memoryInteger(record.height, `${path}.height`, 1),
  };
}

async function parseFixture(value: unknown, directory: string): Promise<ReaderMemoryFixture> {
  const record = exactMemoryRecord(value, FIXTURE_KEYS, 'manifest.fixture');
  const epub = resolve(directory, memoryText(record.epub, 'manifest.fixture.epub'));
  const epubStat = await stat(epub).catch(() => undefined);
  if (!epubStat?.isFile()) {
    throw invalidMemory('manifest.fixture.epub', `must identify a file: ${epub}`);
  }
  return {
    id: memoryText(record.id, 'manifest.fixture.id'),
    epub,
    sha256: memorySha256(record.sha256, 'manifest.fixture.sha256'),
  };
}

function parseScenario(value: unknown): ReaderMemoryScenario {
  const record = exactMemoryRecord(value, SCENARIO_KEYS, 'manifest.scenario');
  const stabilization = exactMemoryRecord(
    record.stabilization,
    STABILIZATION_KEYS,
    'manifest.scenario.stabilization',
  );
  const minSamples = memoryInteger(
    stabilization.minSamples,
    'manifest.scenario.stabilization.minSamples',
    3,
    6,
  );
  const maxSamples = memoryInteger(
    stabilization.maxSamples,
    'manifest.scenario.stabilization.maxSamples',
    minSamples,
    12,
  );
  return {
    replacementRounds: memoryInteger(
      record.replacementRounds,
      'manifest.scenario.replacementRounds',
      2,
      10,
    ),
    stabilization: {
      sampleIntervalMs: memoryInteger(
        stabilization.sampleIntervalMs,
        'manifest.scenario.stabilization.sampleIntervalMs',
        100,
        5_000,
      ),
      minSamples,
      maxSamples,
      maxSampleRangeMiB: memoryFinite(
        stabilization.maxSampleRangeMiB,
        'manifest.scenario.stabilization.maxSampleRangeMiB',
        0.01,
      ),
      maxSampleGrowthMiB: memoryFinite(
        stabilization.maxSampleGrowthMiB,
        'manifest.scenario.stabilization.maxSampleGrowthMiB',
        0,
      ),
    },
  };
}

function parseThresholds(value: unknown): ReaderMemoryThresholds {
  const record = exactMemoryRecord(value, READER_MEMORY_METRIC_KEYS, 'manifest.thresholds');
  return Object.fromEntries(
    READER_MEMORY_METRIC_KEYS.map((key) => [
      key,
      memoryFinite(record[key], `manifest.thresholds.${key}`, 0.01),
    ]),
  ) as unknown as ReaderMemoryThresholds;
}
