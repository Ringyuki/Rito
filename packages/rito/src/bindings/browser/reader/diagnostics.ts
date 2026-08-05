import { cachedHostLineMetricEntries } from '../host-line-metrics';
import { ensureFrameLoaded } from './frame-cache';
import type { BrowserReaderState } from './types';

/**
 * Conformance-instrument surface: the pixel oracle needs the live metric
 * world (what the host measured, what layout still misses, which epoch
 * the published frames were laid under) to tell a layout defect from a
 * metric-plumbing defect. Read-only except `unmetHostLineMetricRequests`,
 * which drains the worker's pending request set exactly like a sync.
 */
export function installBrowserReaderDiagnostics(state: BrowserReaderState): void {
  (globalThis as { __ritoReaderDiagnostics?: unknown }).__ritoReaderDiagnostics = {
    hostLineMetrics: () => cachedHostLineMetricEntries(),
    unmetHostLineMetricRequests: () => state.worker.takeHostLineMetricRequests(),
    hostLineMetricsEpochs: () => ({
      current: state.hostLineMetricsEpoch,
      published: state.publishedHostLineMetricsEpoch,
    }),
    revision: () => state.revisionBundle.revision,
    frame: (spreadIndex: number) => ensureFrameLoaded(state, spreadIndex),
    chapterFragmentProbe: (idref: string) =>
      state.worker.chapterFragmentProbe(state.revisionBundle.revision.revisionId, idref),
  };
}
