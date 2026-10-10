import type { LayoutConfig } from '../../../reader';
import { startSessionReaderBackground } from './background';
import { commitSessionReaderLayout, prepareSessionReaderCandidate } from './commit';
import {
  loadSessionReaderFrame,
  releaseSessionReaderFrame,
  warmSessionReaderNeighbours,
} from './frames';
import {
  sameSessionReaderLayoutConfig,
  sessionReaderLayoutConfig,
  sessionReaderSessionLayout,
} from './layout-options';
import {
  SESSION_READER_RETRY_DELAY_MS,
  runSessionReaderForeground,
  sessionReaderRefusedForNow,
  type SessionReaderState,
} from './state';

/** Refusals in a row a layout request rides out before it is reported as failed. */
const RELAYOUT_ATTEMPTS = 64;

/**
 * Has the session show the host's active spread. Queued once however many
 * spreads the host passes through: the operation reads the active spread
 * when it runs.
 */
export function scheduleSessionReaderShow(state: SessionReaderState): void {
  if (state.showQueued) return;
  state.showQueued = true;
  void runSessionReaderForeground(state, async () => {
    state.showQueued = false;
    await showActiveSpread(state);
  });
}

async function showActiveSpread(state: SessionReaderState): Promise<void> {
  const index = state.activeSpreadIndex;
  const generation = state.layoutGeneration;
  if (state.visible.spreadIndex !== index) {
    const held = state.frames.get(index);
    const frame = held?.committable === true ? held : await loadSessionReaderFrame(state, index);
    if (frame === undefined || generation !== state.layoutGeneration) return;
    // The host moved on while the spread loaded: the show queued behind
    // this one takes its newer target.
    if (state.activeSpreadIndex !== index) return;
    await state.session.commitPeekedArtifact(
      state.visible.artifact.artifactId,
      frame.artifact.artifactId,
    );
    frame.committable = false;
    state.visible = frame;
  }
  warmSessionReaderNeighbours(state);
}

/**
 * Lays the book out again for the options and typography now requested,
 * keeping the reader on the page it shows. Requests made in one task are
 * one layout, and a layout a newer request overtakes does not commit.
 * `force` lays out even when the geometry is unchanged, for a change the
 * geometry does not show (the faces a family resolves to).
 */
export function scheduleSessionReaderRelayout(state: SessionReaderState, force = false): void {
  state.relayoutToken += 1;
  if (force) state.relayoutForced = true;
  if (state.relayoutQueued) return;
  state.relayoutQueued = true;
  queueMicrotask(() => {
    state.relayoutQueued = false;
    const token = state.relayoutToken;
    void runSessionReaderForeground(state, () => relayout(state, token));
  });
}

async function relayout(state: SessionReaderState, token: number): Promise<void> {
  // A newer request queued its own layout behind this one.
  if (token !== state.relayoutToken) return;
  const force = state.relayoutForced;
  state.relayoutForced = false;
  const config = sessionReaderLayoutConfig(state.options, state.typography);
  if (!force && sameSessionReaderLayoutConfig(config, state.config)) return;
  // The whole book of the layout being replaced is no longer wanted.
  state.backgroundToken += 1;
  let again = false;
  try {
    if (await replaceLayout(state, token, config)) state.relayoutRefusals = 0;
  } catch (error) {
    // Refused for now: the options asked for stand, and are asked for again
    // shortly. A session that keeps refusing is reported instead.
    again = sessionReaderRefusedForNow(error) && state.relayoutRefusals < RELAYOUT_ATTEMPTS;
    state.relayoutRefusals = again ? state.relayoutRefusals + 1 : 0;
    if (!again) throw error;
    state.relayoutForced ||= force;
    setTimeout(() => {
      retryRelayout(state, token);
    }, SESSION_READER_RETRY_DELAY_MS);
  } finally {
    // The layout now committed is owed its whole book, unless it is about
    // to be replaced.
    if (!again) startSessionReaderBackground(state);
  }
}

/** Makes a refused layout request again, unless one made since then stands for it. */
function retryRelayout(state: SessionReaderState, token: number): void {
  if (state.disposed) return;
  // The newer request lays out for the same options; it may have found
  // nothing to do, and the layout committed is still owed its book.
  if (token !== state.relayoutToken) startSessionReaderBackground(state);
  else scheduleSessionReaderRelayout(state);
}

/**
 * Asks the session for the page shown under `config` and makes it the
 * committed layout; resolves false for a layout a newer request overtook.
 * The candidate is given back on every path that does not commit it, so a
 * refusal leaves the session holding what it held before.
 */
async function replaceLayout(
  state: SessionReaderState,
  token: number,
  config: LayoutConfig,
): Promise<boolean> {
  const artifact = await state.session.requestArtifact({
    layout: sessionReaderSessionLayout(config, state.dpr),
    locator: state.visible.artifact.locator,
    textProfile: state.visible.artifact.textProfile,
  });
  const { frame, layout } = await prepareSessionReaderCandidate(state, artifact);
  if (state.disposed || token !== state.relayoutToken) {
    await releaseSessionReaderFrame(state, frame);
    return false;
  }
  try {
    await state.session.adoptForegroundCandidate(
      state.visible.artifact.artifactId,
      artifact.artifactId,
    );
  } catch (error) {
    await releaseSessionReaderFrame(state, frame);
    throw error;
  }
  commitSessionReaderLayout(state, frame, layout, config);
  return true;
}
