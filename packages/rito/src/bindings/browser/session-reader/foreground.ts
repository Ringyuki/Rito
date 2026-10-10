import { commitSessionReaderFrame, requestSessionReaderLayout } from './artifacts';
import { commitSessionReaderLayout } from './commit';
import { loadSessionReaderFrame, warmSessionReaderNeighbours } from './frames';
import { sameSessionReaderLayoutConfig, sessionReaderLayoutConfig } from './layout-options';
import { runSessionReaderOperation } from './queue';
import type { SessionReaderState } from './state';

/**
 * Has the session show the host's active spread. Queued once however many
 * spreads the host passes through: the operation reads the active spread
 * when it runs.
 */
export function scheduleSessionReaderShow(state: SessionReaderState): void {
  if (state.showQueued) return;
  state.showQueued = true;
  void runSessionReaderOperation(state, 'asked', async () => {
    state.showQueued = false;
    await showActiveSpread(state);
  });
}

async function showActiveSpread(state: SessionReaderState): Promise<void> {
  const index = state.activeSpreadIndex;
  if (state.visible.spreadIndex !== index && state.view.spreads[index] !== undefined) {
    const held = state.frames.get(index);
    const frame = held?.committable === true ? held : await loadSessionReaderFrame(state, index);
    // The host moved on while the spread loaded: the show queued behind
    // this one takes its newer target.
    if (state.activeSpreadIndex !== index) return;
    await commitSessionReaderFrame(state, frame);
  }
  warmSessionReaderNeighbours(state);
}

/**
 * Lays the book out again for the options and typography now requested,
 * keeping the reader on the page it shows. Only the newest request lays
 * out: requests made in one task are one layout, and a layout a newer
 * request overtakes does not commit. `force` lays out even when the
 * geometry is unchanged, for a change the geometry does not show (the faces
 * a family resolves to).
 */
export function scheduleSessionReaderRelayout(state: SessionReaderState, force = false): void {
  state.relayoutToken += 1;
  if (force) state.relayoutForced = true;
  const token = state.relayoutToken;
  void runSessionReaderOperation(state, 'asked', () => relayout(state, token));
}

async function relayout(state: SessionReaderState, token: number): Promise<void> {
  const overtaken = (): boolean => token !== state.relayoutToken;
  // A newer request queued its own layout behind this one.
  if (overtaken()) return;
  const force = state.relayoutForced;
  state.relayoutForced = false;
  const config = sessionReaderLayoutConfig(state.options, state.typography);
  if (!force && sameSessionReaderLayoutConfig(config, state.config)) return;
  let committed = false;
  try {
    const candidate = await requestSessionReaderLayout(state, config, overtaken);
    if (candidate) {
      await commitSessionReaderLayout(state, candidate, config);
      committed = true;
    }
  } finally {
    // What forced this layout is still not laid out for: the next request is forced too.
    if (!committed) state.relayoutForced ||= force;
  }
}
