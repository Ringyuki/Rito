import { decodeBrowserReaderFrame } from './frame';
import {
  frameImageResourcesAreLoadingOrSettled,
  frameImageResourcesAreSettled,
  preloadFrameResourceBytes,
  recordMissingFrameImageResources,
  type BrowserReaderMissingFrameResource,
} from '../resources';
import type { BrowserReaderFrame, BrowserReaderRevisionHandle, BrowserReaderState } from './types';
import type {
  BrowserReaderFrameBuffer,
  BrowserReaderFrameWindowWarmResult,
} from '../core-contracts';
import { isCurrentRevisionHandle } from './pipeline/revision-handle';
import { trackBrowserReaderHostTask } from './host-tasks';
import { recordBrowserReaderSuspendedFrameMiss } from '../suspended-frame-misses';
import {
  queueBrowserReaderFrameWindowLoad,
  resetBrowserReaderFrameWindowLoadLane,
} from './frame-window-load-lane';

const FRAME_CACHE_CAPACITY = 12;
const completedFrameWindows = new WeakMap<BrowserReaderState, CompletedFrameWindows>();

interface CompletedFrameWindows {
  readonly workerSessionId: string;
  readonly revisionId: string;
  readonly revisionVersion: number;
  readonly coveredSpreads: Set<number>;
}

export function loadFrame(
  state: BrowserReaderState,
  spreadIndex: number,
): BrowserReaderFrame | undefined {
  const frame = state.frames.get(spreadIndex);
  if (frame) cacheFrame(state, spreadIndex, frame);
  return frame;
}

export function cacheFrame(
  state: BrowserReaderState,
  spreadIndex: number,
  frame: BrowserReaderFrame,
): void {
  state.frames.delete(spreadIndex);
  state.frames.set(spreadIndex, frame);
  while (state.frames.size > FRAME_CACHE_CAPACITY) {
    const oldestSpreadIndex = state.frames.keys().next().value;
    if (oldestSpreadIndex === undefined) break;
    state.frames.delete(oldestSpreadIndex);
    completedFrameWindows.get(state)?.coveredSpreads.delete(oldestSpreadIndex);
  }
}

export async function ensureFrameLoaded(
  state: BrowserReaderState,
  spreadIndex: number,
): Promise<BrowserReaderFrame | undefined> {
  const cached = loadFrame(state, spreadIndex);
  if (cached) return cached;
  if (spreadIndex < 0 || spreadIndex >= state.revisionBundle.revision.spreadCount) {
    return undefined;
  }
  const revision = state.revisionHandle;
  if (!revision || !isCurrentRevisionHandle(state, revision)) {
    recordBrowserReaderSuspendedFrameMiss(state, spreadIndex);
    return undefined;
  }
  await loadFrameWindow(state, revision, spreadIndex);
  return loadFrame(state, spreadIndex);
}

export function resetFrameCache(state: BrowserReaderState, preserveFrames = false): void {
  if (!preserveFrames) state.frames = new Map();
  completedFrameWindows.delete(state);
  resetBrowserReaderFrameWindowLoadLane(state);
  state.imageResourceFailures.clear();
  state.settledImageResourceSpreads.clear();
  if (!preserveFrames) state.pendingImageLoads.clear();
}

export function cacheFrameBuffers(
  state: BrowserReaderState,
  revision: BrowserReaderRevisionHandle,
  buffers: readonly BrowserReaderFrameBuffer[],
  options: { readonly notifyFrameInvalidation?: boolean } = {},
): void {
  const notifyFrameInvalidation = options.notifyFrameInvalidation ?? true;
  for (const buffer of buffers) {
    const spreadIndex = buffer.metadata.spreadIndex;
    if (state.frames.has(spreadIndex)) continue;
    try {
      const frame = decodeBrowserReaderFrame(
        state.decodeFrameCommandBuffer,
        revision.revisionId,
        spreadIndex,
        buffer,
      );
      if (state.disposed || !isCurrentRevisionHandle(state, revision)) return;
      cacheFrame(state, spreadIndex, frame);
      if (notifyFrameInvalidation) notifySpreadContentInvalidated(state, spreadIndex);
    } catch (error) {
      // Frame-window warmup is opportunistic; direct render misses can
      // still load frames. A decode failure must stay observable though:
      // a frame that never decodes strands navigation with no console
      // signal at all, which is exactly how a protocol mismatch hides.
      const scope = globalThis as { __ritoFrameDecodeFailures?: unknown[] };
      scope.__ritoFrameDecodeFailures = [
        ...(scope.__ritoFrameDecodeFailures ?? []).slice(-9),
        { spreadIndex, error: String(error).slice(0, 400), at: new Date().toISOString() },
      ];
    }
  }
}

export function applyBrowserReaderFrameWindow(
  state: BrowserReaderState,
  revision: BrowserReaderRevisionHandle,
  frameWindow: BrowserReaderFrameWindowWarmResult | undefined,
  options: { readonly notifyFrameInvalidation?: boolean } = {},
): void {
  if (!frameWindow || state.disposed || !isCurrentRevisionHandle(state, revision)) {
    return;
  }
  cacheFrameBuffers(state, revision, frameWindow.frames, options);
  for (const spread of frameWindow.spreads) {
    const missingResources = frameWindowMissingResources(spread);
    const touchedImageHrefs = [
      ...new Set([
        ...spread.resources
          .filter((resource) => resource.payload.kind === 'image')
          .map((resource) => resource.payload.href),
        ...missingResources
          .filter((resource) => resource.kind === 'image')
          .map((resource) => resource.href),
      ]),
    ];
    const requiresSettlementNotification =
      missingResources.some((resource) => resource.kind === 'image') ||
      touchedImageHrefs.some(
        (href) =>
          !state.images.has(href) && !frameImageResourcesAreSettled(state, revision, [href]),
      );
    recordMissingFrameImageResources(state, revision, missingResources);
    if (!requiresSettlementNotification) continue;
    if (frameImageResourcesAreSettled(state, revision, touchedImageHrefs)) {
      if (markSpreadImageResourcesSettled(state, revision, spread.spreadIndex)) {
        notifySpreadContentInvalidated(state, spread.spreadIndex);
      }
      continue;
    }
    void trackBrowserReaderHostTask(
      state,
      preloadFrameResourceBytes(state, spread.resources, revision).then(() => {
        if (!isCurrentRevisionHandle(state, revision)) return;
        if (
          frameImageResourcesAreSettled(state, revision, touchedImageHrefs) &&
          markSpreadImageResourcesSettled(state, revision, spread.spreadIndex)
        ) {
          notifySpreadContentInvalidated(state, spread.spreadIndex);
        }
      }),
    );
  }
  markFrameWindowCompleted(state, revision, frameWindow.plan.spreadIndexes);
}

export async function warmBrowserReaderFrameWindow(
  state: BrowserReaderState,
  centerSpreadIndex: number,
): Promise<void> {
  const revision = state.revisionHandle;
  if (!revision || !isCurrentRevisionHandle(state, revision)) return;
  if (frameWindowIsCompleted(state, revision, centerSpreadIndex)) return;
  try {
    await loadFrameWindow(state, revision, centerSpreadIndex);
  } catch {
    // Frame-window resource warmup is opportunistic; rendering can request misses on demand.
  }
}

function markFrameWindowCompleted(
  state: BrowserReaderState,
  revision: BrowserReaderRevisionHandle,
  coveredSpreads: readonly number[],
): void {
  const current = completedFrameWindows.get(state);
  if (current && completedWindowMatches(current, revision)) {
    for (const spreadIndex of coveredSpreads) current.coveredSpreads.add(spreadIndex);
    return;
  }
  completedFrameWindows.set(state, {
    workerSessionId: revision.workerSessionId,
    revisionId: revision.revisionId,
    revisionVersion: revision.revisionVersion,
    coveredSpreads: new Set(coveredSpreads),
  });
}

function frameWindowIsCompleted(
  state: BrowserReaderState,
  revision: BrowserReaderRevisionHandle,
  centerSpreadIndex: number,
): boolean {
  const completed = completedFrameWindows.get(state);
  if (!completed || !completedWindowMatches(completed, revision)) return false;
  const frame = state.frames.get(centerSpreadIndex);
  return (
    completed.coveredSpreads.has(centerSpreadIndex) &&
    frame !== undefined &&
    frameImageResourcesAreLoadingOrSettled(state, revision, frame.resourceRefs.images)
  );
}

function frameWindowMissingResources(
  spread: BrowserReaderFrameWindowWarmResult['spreads'][number],
): readonly BrowserReaderMissingFrameResource[] {
  const transport: {
    readonly missingResources?: readonly BrowserReaderMissingFrameResource[] | undefined;
  } = spread;
  return transport.missingResources ?? [];
}

function markSpreadImageResourcesSettled(
  state: BrowserReaderState,
  revision: BrowserReaderRevisionHandle,
  spreadIndex: number,
): boolean {
  const key = JSON.stringify([
    revision.workerSessionId,
    revision.revisionId,
    revision.revisionVersion,
    spreadIndex,
  ]);
  if (state.settledImageResourceSpreads.has(key)) return false;
  state.settledImageResourceSpreads.add(key);
  return true;
}

function completedWindowMatches(
  completed: CompletedFrameWindows,
  revision: BrowserReaderRevisionHandle,
): boolean {
  return (
    completed.workerSessionId === revision.workerSessionId &&
    completed.revisionId === revision.revisionId &&
    completed.revisionVersion === revision.revisionVersion
  );
}

function loadFrameWindow(
  state: BrowserReaderState,
  revision: BrowserReaderRevisionHandle,
  centerSpreadIndex: number,
): Promise<void> {
  if (!isCurrentRevisionHandle(state, revision)) return Promise.resolve();
  if (frameWindowIsCompleted(state, revision, centerSpreadIndex)) return Promise.resolve();
  return queueBrowserReaderFrameWindowLoad(
    state,
    revision,
    centerSpreadIndex,
    (scheduledRevision, scheduledCenterSpreadIndex) => {
      const worker = state.worker;
      if (worker.sessionId !== scheduledRevision.workerSessionId) {
        return Promise.reject(new Error('Reader revision owner does not match its worker session'));
      }
      return worker
        .warmFrameWindowAtRevision(
          {
            revisionId: scheduledRevision.revisionId,
            revisionVersion: scheduledRevision.revisionVersion,
          },
          scheduledCenterSpreadIndex,
        )
        .then(({ value: frameWindow }) => {
          if (state.disposed || !isCurrentRevisionHandle(state, scheduledRevision)) return;
          applyBrowserReaderFrameWindow(state, scheduledRevision, frameWindow);
        });
    },
    frameWindowIsCompleted,
  );
}

function notifySpreadContentInvalidated(state: BrowserReaderState, spreadIndex: number): void {
  for (const cb of state.spreadContentInvalidatedListeners) cb(spreadIndex);
}
