import { createBrowserReaderBoundedSessionOwner } from './bounded-session-owner';
import { openBrowserReaderWorker } from './pinned-fonts';
import type { BrowserReaderBoundedSessionOwner } from './reader-session-host';
import type { BrowserReaderBoundedLayoutRequest } from './bounded-session-runtime';
import type { BrowserReaderBoundedSnapshot } from './core-contracts';
import type { BrowserReaderState } from './reader/types';
import {
  captureHostFontVerticalMetricSamples,
  ensureHostFontFamilyMetrics,
  ensureHostGenericSerifMetrics,
  hostFontMetricSampleCount,
  hostFontVerticalMetricSamplesForDemands,
  type HostFontVerticalMetricDemand,
  type HostFontVerticalMetricSample,
} from './font-metrics';

export type BrowserReaderBoundedReplacementTarget = Pick<
  BrowserReaderBoundedLayoutRequest,
  'targetSpreadIndex' | 'preserveLocator' | 'complete'
>;

type StartCandidate = (
  state: BrowserReaderState,
  owner: BrowserReaderBoundedSessionOwner,
  request: BrowserReaderBoundedLayoutRequest,
) => Promise<BrowserReaderBoundedSnapshot | undefined>;

export interface BrowserReaderHostFontMetricCapture {
  readonly horizontalMetricsChanged: boolean;
  readonly addedVerticalMetricSamples: readonly HostFontVerticalMetricSample[];
  readonly demandedVerticalMetricSamples: readonly HostFontVerticalMetricSample[];
}

/** Allow one fresh Worker for an unchanged metric set, never an unbounded rebuild loop. */
export function createBrowserReaderFontGeometryRetryGuard(
  state: BrowserReaderState,
): () => boolean {
  let sampleCount = hostFontMetricSampleCount(state.fontMetrics);
  let sameMetricSetRetryUsed = false;
  return () => {
    const nextSampleCount = hostFontMetricSampleCount(state.fontMetrics);
    if (nextSampleCount > sampleCount) {
      sampleCount = nextSampleCount;
      sameMetricSetRetryUsed = false;
      return true;
    }
    if (sameMetricSetRetryUsed) return false;
    sameMetricSetRetryUsed = true;
    return true;
  };
}

export function captureBrowserReaderCandidateHostFontMetrics(
  state: BrowserReaderState,
  demands: readonly HostFontVerticalMetricDemand[],
  pinned: boolean,
  fontsReady: boolean,
): BrowserReaderHostFontMetricCapture {
  let horizontalMetricsChanged = false;
  if (!pinned) {
    horizontalMetricsChanged = ensureHostGenericSerifMetrics(state.fontMetrics, state.ctx);
  }
  if (fontsReady && !pinned) {
    horizontalMetricsChanged =
      ensureHostFontFamilyMetrics(
        state.fontMetrics,
        state.ctx,
        [...state.registeredFontFaces.values()].map((face) => face.family),
      ) || horizontalMetricsChanged;
  }
  const addedVerticalMetricSamples = fontsReady
    ? captureHostFontVerticalMetricSamples(state.fontMetrics, state.ctx, demands)
    : [];
  const demandedVerticalMetricSamples = fontsReady
    ? hostFontVerticalMetricSamplesForDemands(state.fontMetrics, demands)
    : [];
  return {
    horizontalMetricsChanged,
    addedVerticalMetricSamples,
    demandedVerticalMetricSamples,
  };
}

/** Rebuild an uncommitted growth snapshot with newly captured host font geometry. */
export async function replaceBrowserReaderFontGeometryMutation(
  state: BrowserReaderState,
  uncalibratedOwner: BrowserReaderBoundedSessionOwner,
  target: () => BrowserReaderBoundedReplacementTarget,
  notifyLayoutCommitted: boolean,
  startCandidate: StartCandidate,
  preserveActiveSpread?: () => boolean,
): Promise<BrowserReaderBoundedSnapshot | undefined> {
  while (fontGeometryReplacementIsLive(state, uncalibratedOwner)) {
    const sampleCount = hostFontMetricSampleCount(state.fontMetrics);
    const worker = state.workerFactory();
    let ownerCreated = false;
    try {
      await openBrowserReaderWorker(
        worker,
        state.documentData.slice(0),
        state.pinnedFonts.policy,
        state.pinnedFonts.summary,
      );
      if (!fontGeometryReplacementIsLive(state, uncalibratedOwner)) return undefined;
      const owner = createBrowserReaderBoundedSessionOwner(worker);
      ownerCreated = true;
      const snapshot = await startCandidate(state, owner, {
        config: state.config,
        spreadMode: state.spreadMode,
        lineBreaking: state.lineBreaking,
        notifyLayoutCommitted,
        ...(preserveActiveSpread ? { preserveActiveSpread } : {}),
        ...target(),
      });
      if (snapshot) return snapshot;
      if (hostFontMetricSampleCount(state.fontMetrics) === sampleCount) return undefined;
    } finally {
      if (!ownerCreated) worker.dispose();
    }
  }
  return undefined;
}

function fontGeometryReplacementIsLive(
  state: BrowserReaderState,
  owner: BrowserReaderBoundedSessionOwner,
): boolean {
  return !state.disposed && state.boundedSessions.current === owner;
}
