import { RitoReaderError } from '../reader-session';
import { startSessionReaderBackground } from './background';
import { commitSessionReaderLayout, readSessionReaderLayout } from './commit';
import {
  loadSessionReaderFrame,
  prepareSessionReaderFrame,
  releaseSessionReaderFrame,
  warmSessionReaderNeighbours,
} from './frames';
import {
  sameSessionReaderLayoutConfig,
  sessionReaderLayoutConfig,
  sessionReaderSessionLayout,
} from './layout-options';
import { runSessionReaderForeground, type SessionReaderState } from './state';

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
  let artifact;
  try {
    artifact = await state.session.requestArtifact({
      layout: sessionReaderSessionLayout(config, state.dpr),
      locator: state.visible.artifact.locator,
      textProfile: state.visible.artifact.textProfile,
    });
  } catch (error) {
    if (error instanceof RitoReaderError && error.code === 'stale-request') return;
    throw error;
  }
  const frame = await prepareSessionReaderFrame(state, artifact, false);
  if (state.disposed || token !== state.relayoutToken) {
    await releaseSessionReaderFrame(state, frame);
    return;
  }
  // The page table is read while the adoption is acknowledged.
  const [, layout] = await Promise.all([
    state.session.adoptForegroundCandidate(state.visible.artifact.artifactId, artifact.artifactId),
    readSessionReaderLayout(state, frame),
  ]);
  commitSessionReaderLayout(state, frame, layout, config);
  startSessionReaderBackground(state);
}
