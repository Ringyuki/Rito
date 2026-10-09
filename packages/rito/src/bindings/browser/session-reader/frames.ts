import type { BrowserReaderArtifact } from '../reader-session';
import {
  notifySessionReaderSpreadInvalidated,
  sessionReaderClosed,
  type SessionReaderFrame,
  type SessionReaderState,
} from './state';

/**
 * The spread at `spreadIndex` of the committed layout, loading it when it
 * is not held. Resolves undefined when the layout was replaced meanwhile or
 * the spread could not be published.
 */
export function ensureSessionReaderFrame(
  state: SessionReaderState,
  spreadIndex: number,
): Promise<SessionReaderFrame | undefined> {
  const held = state.frames.get(spreadIndex);
  if (held) return Promise.resolve(held);
  return loadSessionReaderFrame(state, spreadIndex);
}

/**
 * Asks the session for the spread at `spreadIndex` and installs it, also
 * over a held one: an artifact the session no longer takes as a turn target
 * is replaced this way.
 */
export function loadSessionReaderFrame(
  state: SessionReaderState,
  spreadIndex: number,
): Promise<SessionReaderFrame | undefined> {
  const pending = state.pendingFrames.get(spreadIndex);
  if (pending) return pending;
  if (state.disposed || state.view.spreads[spreadIndex] === undefined) {
    return Promise.resolve(undefined);
  }
  const generation = state.layoutGeneration;
  const load = state.frameLoads.then(() => publishFrame(state, spreadIndex, generation));
  const task = load
    .catch((error: unknown) => {
      if (!state.disposed) state.logger.warn('reader spread load failed', error);
      return undefined;
    })
    .finally(() => {
      if (state.pendingFrames.get(spreadIndex) === task) state.pendingFrames.delete(spreadIndex);
    });
  state.frameLoads = task.then(() => undefined);
  state.pendingFrames.set(spreadIndex, task);
  return task;
}

async function publishFrame(
  state: SessionReaderState,
  spreadIndex: number,
  generation: number,
): Promise<SessionReaderFrame | undefined> {
  if (state.disposed || generation !== state.layoutGeneration) return undefined;
  await releaseSessionReaderFramesOutside(state, spreadIndex);
  const artifact = await state.session.peekSpread(state.visible.artifact.artifactId, spreadIndex);
  if (sessionReaderClosed(state) || generation !== state.layoutGeneration) {
    await releaseArtifact(state, artifact);
    return undefined;
  }
  const frame = await prepareSessionReaderFrame(state, artifact, true);
  if (sessionReaderClosed(state) || generation !== state.layoutGeneration) {
    await releaseSessionReaderFrame(state, frame);
    return undefined;
  }
  const replaced = state.frames.get(spreadIndex);
  state.frames.set(spreadIndex, frame);
  if (replaced && replaced !== state.visible) await releaseSessionReaderFrame(state, replaced);
  notifySessionReaderSpreadInvalidated(state, spreadIndex);
  return frame;
}

/** Prepares an artifact's paint resources; a failure releases the artifact. */
export async function prepareSessionReaderFrame(
  state: SessionReaderState,
  artifact: BrowserReaderArtifact,
  committable: boolean,
): Promise<SessionReaderFrame> {
  try {
    const prepared = await state.presenter.prepare(artifact);
    const spreadIndex = artifact.localSpreadIndex;
    const stopWatchingImages = prepared.onImagesChanged(() => {
      notifySessionReaderSpreadInvalidated(state, spreadIndex);
    });
    return { spreadIndex, artifact, prepared, committable, stopWatchingImages };
  } catch (error) {
    await releaseArtifact(state, artifact);
    throw error;
  }
}

/**
 * Releases every held spread that is neither the session's visible one, the
 * host's active one and its two neighbours, nor `keepIndex`. The session
 * holds a bounded number of artifacts, so what is not near is given back
 * before more is asked for.
 */
export async function releaseSessionReaderFramesOutside(
  state: SessionReaderState,
  keepIndex: number,
): Promise<void> {
  const active = state.activeSpreadIndex;
  const released: SessionReaderFrame[] = [];
  for (const [index, frame] of state.frames) {
    if (frame === state.visible || index === keepIndex || Math.abs(index - active) <= 1) continue;
    state.frames.delete(index);
    released.push(frame);
  }
  await Promise.all(released.map((frame) => releaseSessionReaderFrame(state, frame)));
}

export async function releaseSessionReaderFrame(
  state: SessionReaderState,
  frame: SessionReaderFrame,
): Promise<void> {
  frame.stopWatchingImages();
  try {
    frame.prepared.dispose();
  } catch (error) {
    state.logger.warn('reader spread resources did not release cleanly', error);
  }
  await releaseArtifact(state, frame.artifact);
}

async function releaseArtifact(
  state: SessionReaderState,
  artifact: BrowserReaderArtifact,
): Promise<void> {
  if (state.disposed) return;
  try {
    await state.session.release(artifact.artifactId);
  } catch (error) {
    if (!sessionReaderClosed(state)) state.logger.warn('reader artifact release failed', error);
  }
}

/** Loads the spreads a turn from the active one would show. */
export function warmSessionReaderNeighbours(state: SessionReaderState): void {
  const active = state.activeSpreadIndex;
  for (const index of [active + 1, active - 1]) {
    if (state.view.spreads[index] !== undefined) void ensureSessionReaderFrame(state, index);
  }
}
