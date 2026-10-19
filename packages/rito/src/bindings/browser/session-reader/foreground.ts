import type { Reader } from '../../../reader';
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
 * keeping the reader on the page it shows. Requests made in one task are
 * one layout. A layout under way commits however many requests come
 * meanwhile, and of those only the newest lays out next, as in rito_flutter:
 * a host sending a new size every frame sees one each time a layout ends,
 * where dropping the overtaken layout showed nothing until the sizes
 * stopped whenever a chapter took longer than a frame to lay out. `force`
 * lays out even when the geometry is unchanged, for a change the geometry
 * does not show (the faces a family resolves to).
 */
export function scheduleSessionReaderRelayout(state: SessionReaderState, force = false): void {
  state.relayoutToken += 1;
  if (force) state.relayoutForced = true;
  const token = state.relayoutToken;
  void runSessionReaderOperation(state, 'asked', () => relayout(state, token));
}

async function relayout(state: SessionReaderState, token: number): Promise<void> {
  // A newer request queued its own layout behind this one.
  if (token !== state.relayoutToken) return;
  const force = state.relayoutForced;
  state.relayoutForced = false;
  const config = sessionReaderLayoutConfig(state.options, state.typography);
  const ratio = state.options.devicePixelRatio ?? state.dpr;
  if (!force && ratio === state.dpr && sameSessionReaderLayoutConfig(config, state.config)) return;
  let committed = false;
  try {
    const candidate = await requestSessionReaderLayout(state, config, ratio);
    await commitSessionReaderLayout(state, candidate, config);
    committed = true;
  } finally {
    // What forced this layout is still not laid out for: the next request is forced too.
    if (!committed) state.relayoutForced ||= force;
  }
}

/** What a page is laid out in: its size, its spreads and the ratio it is painted at. */
export function sessionReaderGeometryMethods(
  state: SessionReaderState,
): Pick<Reader, 'resize' | 'setDevicePixelRatio' | 'setSpreadMode' | 'updateLayout'> {
  return {
    resize(width, height) {
      state.options = { ...state.options, width, height };
      scheduleSessionReaderRelayout(state);
    },
    setDevicePixelRatio(ratio) {
      if (!Number.isFinite(ratio) || ratio <= 0) {
        throw new RangeError(`A device pixel ratio is a positive number, not ${String(ratio)}`);
      }
      state.options = { ...state.options, devicePixelRatio: ratio };
      scheduleSessionReaderRelayout(state);
    },
    setSpreadMode(mode) {
      state.options = { ...state.options, spread: mode };
      scheduleSessionReaderRelayout(state);
      return false;
    },
    updateLayout(width, height, spreadMode, margin) {
      state.options = {
        ...state.options,
        width,
        height,
        ...(spreadMode === undefined ? {} : { spread: spreadMode }),
        ...(margin === undefined ? {} : { margin }),
      };
      scheduleSessionReaderRelayout(state);
      return false;
    },
  };
}

/** How the text looks: its colours and the reader's typography. */
export function sessionReaderAppearanceMethods(
  state: SessionReaderState,
): Pick<Reader, 'setTheme' | 'setTypography'> {
  return {
    setTheme(theme) {
      const { bgColor, fgColor } = state;
      if (theme.backgroundColor !== undefined) state.bgColor = theme.backgroundColor ?? '#ffffff';
      if (theme.foregroundColor !== undefined) state.fgColor = theme.foregroundColor ?? undefined;
      if (state.bgColor === bgColor && state.fgColor === fgColor) return;
      // Colours are read at paint time, so every loaded spread stays valid
      // but nothing repaints on its own: the invalidation is the cue.
      for (const listener of state.spreadContentInvalidatedListeners) {
        listener(state.activeSpreadIndex);
      }
    },
    setTypography(next) {
      const { typography } = state;
      if (next.fontSize !== undefined) typography.fontSize = next.fontSize ?? undefined;
      if (next.lineHeight !== undefined) typography.lineHeight = next.lineHeight ?? undefined;
      if (next.lineHeightForce !== undefined) typography.lineHeightForce = next.lineHeightForce;
      if (next.fontFamily !== undefined) typography.fontFamily = next.fontFamily ?? undefined;
      if (next.fontFamilyForce !== undefined) typography.fontFamilyForce = next.fontFamilyForce;
      scheduleSessionReaderRelayout(state);
      return false;
    },
  };
}
