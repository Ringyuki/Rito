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
  chapterLocalPreviewMode: 'enabled',
  artifact: {
    schemaVersion: 1,
    id: 'rito/reader-dist-v1',
    readerDistSha256: 'd'.repeat(64),
    fileCount: 4,
    byteLength: 1024,
  },
  execution: {
    skippedE2eBuild: true,
    strictServer: true,
    abPairId: null,
    abOrder: null,
  },
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
    schemaVersion: 5,
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
      tocSupersede: profileStage(value),
      freshFarBootstrap: profileStage(value),
      farToc: { ...profileStage(value), workerRequestsToFirstFrame: value },
      reflow: profileStage(value),
    },
    transitions: {
      cachedTurn: transition,
      deferredGrowth: transition,
      tocSupersede: {
        fromHref: 'chapter-2.xhtml',
        toHref: 'chapter-1.xhtml',
        supersededHref: 'chapter-99.xhtml',
        observedHrefs: ['chapter-1.xhtml'],
        observedHrefObservations: [{ href: 'chapter-1.xhtml', observedAt: 2 }],
        supersededAt: 1,
        heldContinuationRequestId: 1,
        heldResponses: [
          {
            workerId: 1,
            category: 'mainContinuation',
            kind: 'continueRevision',
            requestId: 1,
            heldAt: 1,
            releasedAt: 2,
          },
        ],
        staleCommitCount: 0,
        checksumBefore: 'before',
        checksumAfter: 'after',
      },
      freshFarGeneration: {
        previousRevisionIds: ['revision-old'],
        freshRevisionIds: ['revision-fresh'],
        previousWorkerCount: 1,
        closedWorkerCount: 1,
        workersBeforeOpen: 0,
        freshWorkerCount: 1,
        positionStorageKey: 'rito-position',
        positionClearedBeforeOpen: true,
        freshProbeOperationIndex: 0,
        freshOpenRequestId: 1,
        freshRevisionRequestId: 2,
        checksumAfter: 'fresh',
      },
      farToc: {
        fromHref: 'chapter-1.xhtml',
        toHref: 'chapter-99.xhtml',
        checksumBefore: 'before',
        checksumAfter: 'after',
        presentation: 'animated',
        latency: {
          acceptedToTransitionStartMs: value,
          acceptedToFirstVisualChangeMs: value,
          acceptedToFirstTargetFrameMs: value,
          firstTargetFrameRelativeToTransitionEndMs: 0,
          acceptedToTransitionEndMs: value,
          acceptedToStableIdleObservationMs: value,
        },
        animation: {
          durationMs: value,
          sampledFrameCount: 12,
          nominalFrameIntervalMs: 16.667,
          p50FrameIntervalMs: 16.667,
          p95FrameIntervalMs: 16.667,
          maxFrameIntervalMs: 16.667,
          overBudgetFrameIntervalCount: 0,
          estimatedDroppedFrameCount: 0,
          distinctVisualCount: 3,
          blankFrameCount: 0,
        },
      },
    },
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
    cachedTurnStableMs: value,
    deferredGrowthFirstFrameMs: value,
    tocSupersedeFirstFrameMs: value,
    farTocFirstFrameMs: value,
    farTocWorkerRequestsToFirstFrame: value,
    reflowFirstFrameMs: value,
    maxLongTaskMs: value,
  };
}

export function readerGateTestManifest(): ReaderGateTestJson {
  return {
    schemaVersion: 4,
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
