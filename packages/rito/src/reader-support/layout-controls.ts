import { buildSpreads } from '../layout/spread';
import { paginateWithAssets, type Resources } from '../render/resources';
import type { ReaderOptions } from '../reader';
import type { EpubDocument } from '../runtime/types';
import { getChapterStartPages, layoutConfigEqual, makeLayoutConfig } from './layout-utils';
import type { ReaderState } from './types';

interface ReaderLayoutControls {
  resize(width: number, height: number): void;
  setSpreadMode(mode: 'single' | 'double'): void;
  updateLayout(width: number, height: number, mode?: 'single' | 'double'): boolean;
}

export function createReaderLayoutControls(
  state: ReaderState,
  doc: EpubDocument,
  options: ReaderOptions,
): ReaderLayoutControls {
  return {
    resize: (width: number, height: number): void => {
      repaginate(state, doc, options, width, height);
    },
    setSpreadMode: (mode: 'single' | 'double'): void => {
      repaginate(
        state,
        doc,
        options,
        state.config.viewportWidth,
        state.config.viewportHeight,
        mode,
      );
    },
    updateLayout: (width: number, height: number, mode = state.spreadMode): boolean =>
      repaginate(state, doc, options, width, height, mode),
  };
}

function repaginate(
  state: ReaderState,
  doc: EpubDocument,
  options: ReaderOptions,
  width: number,
  height: number,
  spreadMode = state.spreadMode,
): boolean {
  const newConfig = makeLayoutConfig({ ...options, width, height }, spreadMode);
  state.spreadMode = spreadMode;
  if (layoutConfigEqual(state.config, newConfig)) return false;

  state.config = newConfig;
  state.assets.measurer.clearCache();
  state.logger.info('Repagination triggered: %dx%d, spread=%s', width, height, spreadMode);

  const paginationResult = paginateWithAssets(
    doc,
    state.config,
    state.assets,
    options.lineBreaking,
    state.logger,
  );
  state.resources = toResources(state, paginationResult);
  state.spreads = buildSpreads(
    state.resources.pages,
    state.config,
    getChapterStartPages(state.resources.chapterMap),
  );
  return true;
}

function toResources(state: ReaderState, paginationResult: Omit<Resources, 'images'>): Resources {
  return { ...paginationResult, images: state.assets.images };
}
