import type {
  ReaderLoadProfileReport,
  ReaderProfileEnvironment,
  ReaderProfileMilestones,
  ReaderProfileStage,
  ReaderProfileTransition,
  ReaderUsabilityMetrics,
} from './reader-profile-model';

export const READER_GATE_TEST_SHA256 = 'a'.repeat(64);

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
    schemaVersion: 1,
    generatedAt: '2026-07-16T00:00:00.000Z',
    environment: overrides.environment ?? READER_GATE_TEST_ENVIRONMENT,
    fixture: {
      id: overrides.fixtureId ?? 'fixture',
      path: '/fixture.epub',
      byteLength: 4,
      sha256: overrides.sha256 ?? READER_GATE_TEST_SHA256,
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
