import { peekSessionReaderFrame, releaseSessionReaderFrame } from './artifacts';
import { runSessionReaderOperation } from './queue';
import {
  notifySessionReaderSpreadInvalidated,
  type SessionReaderFrame,
  type SessionReaderState,
} from './state';

/**
 * The spread at `spreadIndex` of the committed layout, loading it ahead of
 * need when it is not held. Resolves undefined when the layout was replaced
 * before the load ran or the spread could not be published.
 */
export function ensureSessionReaderFrame(
  state: SessionReaderState,
  spreadIndex: number,
): Promise<SessionReaderFrame | undefined> {
  const held = state.frames.get(spreadIndex);
  if (held) return Promise.resolve(held);
  const pending = state.pendingFrames.get(spreadIndex);
  if (pending) return pending;
  if (state.disposed || state.view.spreads[spreadIndex] === undefined) {
    return Promise.resolve(undefined);
  }
  const generation = state.layoutGeneration;
  const load = runSessionReaderOperation(state, 'ahead', async () => {
    if (generation !== state.layoutGeneration) return undefined;
    // A turn onto the spread may have loaded it while this waited.
    return state.frames.get(spreadIndex) ?? loadSessionReaderFrame(state, spreadIndex);
  }).finally(() => {
    if (state.pendingFrames.get(spreadIndex) === load) state.pendingFrames.delete(spreadIndex);
  });
  state.pendingFrames.set(spreadIndex, load);
  return load;
}

/**
 * Asks the session for the spread at `spreadIndex` and installs it, also
 * over a held one: an artifact the session no longer takes as a turn target
 * is replaced this way. Part of the operation that calls it.
 */
export async function loadSessionReaderFrame(
  state: SessionReaderState,
  spreadIndex: number,
): Promise<SessionReaderFrame> {
  await releaseFramesOutside(state, spreadIndex);
  const frame = await peekSessionReaderFrame(state, spreadIndex);
  const replaced = state.frames.get(spreadIndex);
  state.frames.set(spreadIndex, frame);
  if (replaced && replaced !== state.visible) await releaseSessionReaderFrame(state, replaced);
  notifySessionReaderSpreadInvalidated(state, spreadIndex);
  return frame;
}

/**
 * The spreads near the host's active one: its neighbours, and in a scrolled
 * view the window after them too, which a viewport shows with the window
 * read.
 */
function nearActive(state: SessionReaderState): readonly number[] {
  const active = state.activeSpreadIndex;
  const ahead = state.view.scroll === undefined ? [] : [active + 2];
  return [active + 1, active - 1, ...ahead];
}

/**
 * Releases every held spread that is neither the session's visible one, the
 * host's active one and the spreads near it, nor `keepIndex`. The session
 * holds a bounded number of artifacts, so what is not near is given back
 * before more is asked for.
 */
async function releaseFramesOutside(state: SessionReaderState, keepIndex: number): Promise<void> {
  const near = new Set([state.activeSpreadIndex, keepIndex, ...nearActive(state)]);
  const released: SessionReaderFrame[] = [];
  for (const [index, frame] of state.frames) {
    if (frame === state.visible || near.has(index)) continue;
    state.frames.delete(index);
    released.push(frame);
  }
  await Promise.all(released.map((frame) => releaseSessionReaderFrame(state, frame)));
}

/**
 * Loads the spreads a turn from the active one would show, unless a host
 * holds the book: the next size replaces their layout, and a load under
 * way holds that size back. Releasing the last hold loads them.
 */
export function warmSessionReaderNeighbours(state: SessionReaderState): void {
  if (state.bookHolds > 0) return;
  for (const index of nearActive(state)) {
    if (state.view.spreads[index] !== undefined) void ensureSessionReaderFrame(state, index);
  }
}
