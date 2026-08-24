import type { ReaderLoadProfileReport } from './reader-profile-model';

export interface ReaderUsabilityMetrics {
  readonly browserLaunchMs: number;
  readonly navigationToReaderReadyMs: number;
  readonly navigationToFirstCanvasMs: number;
  readonly startupMaxLongTaskMs: number;
  readonly openRoundTripMs: number;
  readonly boundedToPresentationMs: number;
  readonly frameWarmRoundTripMs: number;
  readonly canvasReadyMs: number;
  readonly cachedTurnFirstFrameMs: number;
  readonly cachedTurnStableMs: number;
  readonly deferredGrowthFirstFrameMs: number;
  readonly tocSupersedeFirstFrameMs: number;
  readonly farTocFirstFrameMs: number;
  readonly farTocWorkerRequestsToFirstFrame: number;
  readonly reflowFirstFrameMs: number;
  readonly maxLongTaskMs: number;
}

export const READER_USABILITY_METRIC_KEYS = [
  'browserLaunchMs',
  'navigationToReaderReadyMs',
  'navigationToFirstCanvasMs',
  'startupMaxLongTaskMs',
  'openRoundTripMs',
  'boundedToPresentationMs',
  'frameWarmRoundTripMs',
  'canvasReadyMs',
  'cachedTurnFirstFrameMs',
  'cachedTurnStableMs',
  'deferredGrowthFirstFrameMs',
  'tocSupersedeFirstFrameMs',
  'farTocFirstFrameMs',
  'farTocWorkerRequestsToFirstFrame',
  'reflowFirstFrameMs',
  'maxLongTaskMs',
] as const satisfies readonly (keyof ReaderUsabilityMetrics)[];

export function readerUsabilityMetrics(report: ReaderLoadProfileReport): ReaderUsabilityMetrics {
  const browserLaunchMs = report.startup.browserLaunchMs;
  if (browserLaunchMs === null || report.startup.browser.isolation !== 'process-per-run') {
    throw new Error('Reader usability metrics require an isolated browser-process report');
  }
  return {
    browserLaunchMs,
    navigationToReaderReadyMs: report.startup.navigationToReaderReadyMs,
    navigationToFirstCanvasMs: report.startup.navigationToFirstCanvasMs,
    startupMaxLongTaskMs: report.startup.longTasks.maxMs,
    openRoundTripMs: report.milestones.openRoundTripMs,
    boundedToPresentationMs: report.milestones.boundedToPresentationMs,
    frameWarmRoundTripMs: report.milestones.frameWarmRoundTripMs,
    canvasReadyMs: report.milestones.canvasReadyMs,
    cachedTurnFirstFrameMs: report.stages.cachedTurn.durationMs,
    cachedTurnStableMs: report.stages.cachedTurn.observedDurationMs,
    deferredGrowthFirstFrameMs: report.stages.deferredGrowth.durationMs,
    tocSupersedeFirstFrameMs: report.stages.tocSupersede.durationMs,
    farTocFirstFrameMs: report.stages.farToc.durationMs,
    farTocWorkerRequestsToFirstFrame: report.stages.farToc.workerRequestsToFirstFrame,
    reflowFirstFrameMs: report.stages.reflow.durationMs,
    maxLongTaskMs: Math.max(
      report.stages.initial.longTasks.maxMs,
      report.stages.cachedTurn.longTasks.maxMs,
      report.stages.deferredGrowth.longTasks.maxMs,
      report.stages.tocSupersede.longTasks.maxMs,
      report.stages.freshFarBootstrap.longTasks.maxMs,
      report.stages.farToc.longTasks.maxMs,
      report.stages.reflow.longTasks.maxMs,
    ),
  };
}

export function mapReaderUsabilityMetrics(
  value: (key: keyof ReaderUsabilityMetrics) => number,
): ReaderUsabilityMetrics {
  return {
    browserLaunchMs: value('browserLaunchMs'),
    navigationToReaderReadyMs: value('navigationToReaderReadyMs'),
    navigationToFirstCanvasMs: value('navigationToFirstCanvasMs'),
    startupMaxLongTaskMs: value('startupMaxLongTaskMs'),
    openRoundTripMs: value('openRoundTripMs'),
    boundedToPresentationMs: value('boundedToPresentationMs'),
    frameWarmRoundTripMs: value('frameWarmRoundTripMs'),
    canvasReadyMs: value('canvasReadyMs'),
    cachedTurnFirstFrameMs: value('cachedTurnFirstFrameMs'),
    cachedTurnStableMs: value('cachedTurnStableMs'),
    deferredGrowthFirstFrameMs: value('deferredGrowthFirstFrameMs'),
    tocSupersedeFirstFrameMs: value('tocSupersedeFirstFrameMs'),
    farTocFirstFrameMs: value('farTocFirstFrameMs'),
    farTocWorkerRequestsToFirstFrame: value('farTocWorkerRequestsToFirstFrame'),
    reflowFirstFrameMs: value('reflowFirstFrameMs'),
    maxLongTaskMs: value('maxLongTaskMs'),
  };
}
