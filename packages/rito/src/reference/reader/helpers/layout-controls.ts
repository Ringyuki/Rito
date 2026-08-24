import { buildSpreads } from '../../ts-core/layout/spread';
import { paginateWithAssets, type Resources } from '../resources';
import type { ReaderOptions } from '../../../reader';
import type { EpubDocument } from '../../ts-core/runtime/types';
import { getChapterStartPages, layoutConfigEqual, makeLayoutConfig } from './layout-utils';
import type { ReaderState } from './types';

interface ReaderLayoutControls {
  resize(width: number, height: number): void;
  setSpreadMode(mode: 'single' | 'double'): boolean;
  setLineBreaking(lineBreaking: 'greedy' | 'optimal'): boolean;
  updateLayout(width: number, height: number, mode?: 'single' | 'double', margin?: number): boolean;
}

export function createReaderLayoutControls(
  state: ReaderState,
  doc: EpubDocument,
  options: ReaderOptions,
): ReaderLayoutControls {
  let marginOverride: number | undefined;

  function getOptions(): ReaderOptions {
    return marginOverride !== undefined ? { ...options, margin: marginOverride } : options;
  }

  return {
    resize: (width: number, height: number): void => {
      repaginate(state, doc, getOptions(), width, height);
    },
    setSpreadMode: (mode: 'single' | 'double'): boolean => {
      return repaginate(
        state,
        doc,
        getOptions(),
        state.config.viewportWidth,
        state.config.viewportHeight,
        mode,
      );
    },
    setLineBreaking: (lineBreaking: 'greedy' | 'optimal'): boolean => {
      return repaginate(
        state,
        doc,
        getOptions(),
        state.config.viewportWidth,
        state.config.viewportHeight,
        state.spreadMode,
        lineBreaking,
      );
    },
    updateLayout: (
      width: number,
      height: number,
      mode = state.spreadMode,
      margin?: number,
    ): boolean => {
      if (margin !== undefined) marginOverride = margin;
      return repaginate(state, doc, getOptions(), width, height, mode);
    },
  };
}

function repaginate(
  state: ReaderState,
  doc: EpubDocument,
  options: ReaderOptions,
  width: number,
  height: number,
  spreadMode = state.spreadMode,
  lineBreaking = state.lineBreaking,
): boolean {
  const newConfig = makeLayoutConfig(
    { ...options, width, height },
    spreadMode,
    state.fontSizeOverride,
    state.lineHeightOverride,
    state.fontFamilyOverride,
    state.lineHeightForce,
    state.fontFamilyForce,
  );
  const lineBreakingChanged = state.lineBreaking !== lineBreaking;
  state.spreadMode = spreadMode;
  state.lineBreaking = lineBreaking;
  if (!lineBreakingChanged && layoutConfigEqual(state.config, newConfig)) return false;

  state.config = newConfig;
  state.assets.measurer.clearCache();
  state.logger.info(
    'Repagination triggered: %dx%d, spread=%s, lineBreaking=%s',
    width,
    height,
    spreadMode,
    lineBreaking,
  );

  const paginationResult = paginateWithAssets(
    doc,
    state.config,
    state.assets,
    lineBreaking,
    state.logger,
  );
  state.resources = toResources(state, paginationResult);
  state.spreads = buildSpreads(
    state.resources.pages,
    state.config,
    getChapterStartPages(state.resources.chapterMap),
  );
  state.activeSpreadIndex = clampActiveSpread(state.activeSpreadIndex, state.spreads.length);
  return true;
}

function clampActiveSpread(activeSpreadIndex: number, spreadCount: number): number {
  return Math.max(0, Math.min(activeSpreadIndex, spreadCount - 1));
}

function toResources(state: ReaderState, paginationResult: Omit<Resources, 'images'>): Resources {
  return { ...paginationResult, images: state.assets.images };
}
