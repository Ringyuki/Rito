import { buildSpreads } from '../../layout/spread';
import { loadAssets, paginateWithAssets, type Resources } from '../../render/assets';
import type { ReaderOptions } from '../../reader';
import type { EpubDocument } from '../../runtime/types';
import { createLogger } from '../../utils/logger';
import { getChapterStartPages, makeLayoutConfig } from './layout-utils';
import type { ReaderState } from './types';

export async function initReaderState(
  doc: EpubDocument,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: ReaderOptions,
): Promise<ReaderState> {
  const logger = createLogger(options.logLevel ?? 'warn');
  const spreadMode = options.spread ?? 'single';
  const lineBreaking = normalizeLineBreaking(options.lineBreaking);
  const dpr =
    options.devicePixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1);
  const config = makeLayoutConfig(options, spreadMode);
  const assets = await loadAssets(doc, canvas, logger);
  const paginationResult = paginateWithAssets(doc, config, assets, lineBreaking, logger);
  const resources: Resources = { ...paginationResult, images: assets.images };

  logger.info('Reader created: %dx%d, spread=%s', options.width, options.height, spreadMode);
  return {
    logger,
    spreadMode,
    lineBreaking,
    bgColor: options.backgroundColor ?? '#ffffff',
    fgColor: options.foregroundColor,
    dpr,
    config,
    assets,
    resources,
    spreads: buildSpreads(resources.pages, config, getChapterStartPages(resources.chapterMap)),
    spreadRenderedListeners: new Set(),
    fontSizeOverride: undefined,
    lineHeightOverride: undefined,
    lineHeightForce: false,
    fontFamilyOverride: undefined,
    fontFamilyForce: false,
  };
}

function normalizeLineBreaking(lineBreaking: ReaderOptions['lineBreaking']): 'greedy' | 'optimal' {
  return lineBreaking ?? 'greedy';
}
