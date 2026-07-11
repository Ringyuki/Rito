import { decodeBrowserReaderFrame } from './frame';
import { preloadFrameResourceBytes } from '../resources';
import type { BrowserReaderFrame, BrowserReaderState } from './types';
import type { BrowserReaderRevisionHandle } from './types';
import type {
  BrowserReaderFrameBuffer,
  BrowserReaderFrameWindowWarmResult,
} from '../core-contracts';
import { isCurrentRevisionHandle } from './pipeline/revision-handle';

const FRAME_CACHE_CAPACITY = 12;

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
  if (!revision) return undefined;
  await loadFrameWindow(state, revision, spreadIndex);
  return loadFrame(state, spreadIndex);
}

export function resetFrameCache(state: BrowserReaderState): void {
  state.frames = new Map();
  state.pendingFrameLoads.clear();
  state.pendingImageLoads.clear();
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
    } catch {
      // Frame-window warmup is opportunistic; direct render misses can still load frames.
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
    const missingImageHrefs = spread.resources
      .filter(
        (resource) => resource.payload.kind === 'image' && !state.images.has(resource.payload.href),
      )
      .map((resource) => resource.payload.href);
    if (missingImageHrefs.length === 0) continue;
    void preloadFrameResourceBytes(state, spread.resources).then(() => {
      if (!isCurrentRevisionHandle(state, revision)) return;
      if (missingImageHrefs.some((href) => state.images.has(href))) {
        notifySpreadContentInvalidated(state, spread.spreadIndex);
      }
    });
  }
}

export async function warmBrowserReaderFrameWindow(
  state: BrowserReaderState,
  centerSpreadIndex: number,
): Promise<void> {
  const revision = state.revisionHandle;
  if (!revision) return;
  try {
    await loadFrameWindow(state, revision, centerSpreadIndex);
  } catch {
    // Frame-window resource warmup is opportunistic; rendering can request misses on demand.
  }
}

function loadFrameWindow(
  state: BrowserReaderState,
  revision: BrowserReaderRevisionHandle,
  centerSpreadIndex: number,
): Promise<void> {
  const pending = state.pendingFrameLoads.get(centerSpreadIndex);
  if (pending) return pending;
  const worker = state.worker;
  if (worker.sessionId !== revision.workerSessionId) {
    return Promise.reject(new Error('Reader revision owner does not match its worker session'));
  }
  const task = worker
    .warmFrameWindow(revision.revisionId, centerSpreadIndex)
    .then((frameWindow) => {
      if (state.disposed || !isCurrentRevisionHandle(state, revision)) return;
      applyBrowserReaderFrameWindow(state, revision, frameWindow);
    })
    .finally(() => {
      if (state.pendingFrameLoads.get(centerSpreadIndex) === task)
        state.pendingFrameLoads.delete(centerSpreadIndex);
    });
  state.pendingFrameLoads.set(centerSpreadIndex, task);
  return task;
}

function notifySpreadContentInvalidated(state: BrowserReaderState, spreadIndex: number): void {
  for (const cb of state.spreadContentInvalidatedListeners) cb(spreadIndex);
}
