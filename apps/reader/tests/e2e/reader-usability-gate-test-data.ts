import type {
  ReaderLoadProfileReport,
  ReaderProfileEnvironment,
  ReaderProfileMilestones,
  ReaderProfileStage,
  ReaderProfileTransition,
} from './reader-profile-model';
import type { ReaderUsabilityMetrics } from './reader-usability-metrics';

export const READER_GATE_TEST_SHA256 = 'a'.repeat(64);
export type ReaderGateTestJson = Record<string, unknown>;

export const READER_GATE_TEST_ENVIRONMENT: ReaderProfileEnvironment = {
  machineId: 'local-m3',
  platform: 'darwin',
  arch: 'arm64',
  cpuModel: 'Apple M3 Pro',
  osRelease: '25.5.0',
  browserName: 'Chromium',
  browserVersion: '140.0.0.0',
  deviceScaleFactor: 2,
  viewport: { width: 1280, height: 800 },
  reflowViewport: { width: 900, height: 700 },
};

interface ProfileOverrides {
  readonly fixtureId?: string;
  readonly sha256?: string;
  readonly environment?: ReaderProfileEnvironment;
}

export function readerGateTestProfile(
  value: number,
  overrides: ProfileOverrides = {},
): ReaderLoadProfileReport {
  const transition = profileTransition();
  return {
    schemaVersion: 2,
    generatedAt: '2026-07-16T00:00:00.000Z',
    environment: overrides.environment ?? READER_GATE_TEST_ENVIRONMENT,
    fixture: {
      id: overrides.fixtureId ?? 'fixture',
      path: '/fixture.epub',
      byteLength: 4,
      sha256: overrides.sha256 ?? READER_GATE_TEST_SHA256,
    },
    startup: {
      browser: {
        isolation: 'process-per-run',
        channel: 'bundled',
        headless: true,
        locale: 'en-US',
        colorScheme: 'light',
      },
      browserLaunchMs: value,
      navigationToReaderReadyMs: value,
      navigationToFirstCanvasMs: value,
      longTasks: { count: 1, totalMs: value, maxMs: value },
    },
    milestones: profileMilestones(value),
    stages: {
      initial: profileStage(value),
      cachedTurn: profileStage(value),
      deferredGrowth: profileStage(value),
      reflow: profileStage(value),
    },
    transitions: { cachedTurn: transition, deferredGrowth: transition },
    operationsByKind: [],
    operations: [],
    longTasks: { count: 1, totalMs: value, maxMs: value },
    browserErrors: [],
  };
}

export function readerGateTestMetrics(value: number): ReaderUsabilityMetrics {
  return {
    browserLaunchMs: value,
    navigationToReaderReadyMs: value,
    navigationToFirstCanvasMs: value,
    startupMaxLongTaskMs: value,
    openRoundTripMs: value,
    boundedToPresentationMs: value,
    frameWarmRoundTripMs: value,
    canvasReadyMs: value,
    cachedTurnFirstFrameMs: value,
    deferredGrowthFirstFrameMs: value,
    reflowFirstFrameMs: value,
    maxLongTaskMs: value,
  };
}

export function readerGateTestManifest(): ReaderGateTestJson {
  return {
    schemaVersion: 2,
    machine: {
      id: READER_GATE_TEST_ENVIRONMENT.machineId,
      platform: READER_GATE_TEST_ENVIRONMENT.platform,
      arch: READER_GATE_TEST_ENVIRONMENT.arch,
      cpuModel: READER_GATE_TEST_ENVIRONMENT.cpuModel,
      osRelease: READER_GATE_TEST_ENVIRONMENT.osRelease,
      browserName: READER_GATE_TEST_ENVIRONMENT.browserName,
      browserVersion: READER_GATE_TEST_ENVIRONMENT.browserVersion,
    },
    browser: {
      isolation: 'process-per-run',
      channel: 'bundled',
      headless: true,
      locale: 'en-US',
      colorScheme: 'light',
    },
    pinnedFonts: [
      { sha256: 'b'.repeat(64), byteLength: 10, genericRole: 'serif', language: 'und' },
      { sha256: 'c'.repeat(64), byteLength: 20, genericRole: 'serif', language: 'zh-hans' },
    ],
    deviceScaleFactor: READER_GATE_TEST_ENVIRONMENT.deviceScaleFactor,
    viewport: { ...READER_GATE_TEST_ENVIRONMENT.viewport },
    reflowViewport: { ...READER_GATE_TEST_ENVIRONMENT.reflowViewport },
    runs: 3,
    cases: [
      {
        id: 'fixture',
        epub: './fixture.epub',
        sha256: READER_GATE_TEST_SHA256,
        thresholds: readerGateTestMetrics(10),
      },
    ],
  };
}

function profileStage(durationMs: number): ReaderProfileStage {
  return {
    durationMs,
    observedDurationMs: durationMs,
    operationsByKind: [],
    operations: [],
    longTasks: { count: 1, totalMs: durationMs, maxMs: durationMs },
  };
}

function profileMilestones(value: number): ReaderProfileMilestones {
  return {
    inputToOpenMs: 0,
    openRoundTripMs: value,
    boundedToPresentationMs: value,
    frameWarmRoundTripMs: value,
    aggregateReadMs: 0,
    hostCommitGapMs: 0,
    loadedToCanvasMs: 0,
    loadedMs: value,
    canvasReadyMs: value,
  };
}

function profileTransition(): ReaderProfileTransition {
  return {
    fromSpread: 0,
    toSpread: 1,
    knownSpreadCountBefore: 1,
    knownSpreadCountAfter: 2,
    checksumBefore: 'before',
    checksumAfter: 'after',
  };
}
