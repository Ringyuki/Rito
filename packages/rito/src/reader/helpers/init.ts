import { buildSpreads } from '../../layout/spread';
import { disposeAssets, loadAssets } from '../../render/web';
import type { ReaderOptions } from '../../reader';
import type { EpubDocument } from '../../runtime/types';
import { createLogger } from '../../utils/logger';
import { getChapterStartPages, makeLayoutConfig } from './layout-utils';
import type { ReaderState } from './types';
import { paginateWithAssets, type Resources } from '../resources';

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
  const config = makeLayoutConfig(
    options,
    spreadMode,
    options.fontSize,
    options.lineHeight,
    options.fontFamily,
    options.lineHeightForce,
    options.fontFamilyForce,
  );
  const assets = await loadAssets(doc, canvas, logger);
  let resources: Resources;
  try {
    const paginationResult = paginateWithAssets(doc, config, assets, lineBreaking, logger);
    resources = { ...paginationResult, images: assets.images };
  } catch (error: unknown) {
    disposeAssets(assets);
    throw error;
  }

  logger.info('Reader created: %dx%d, spread=%s', options.width, options.height, spreadMode);
  return {
    logger,
    spreadMode,
    lineBreaking,
    bgColor: options.backgroundColor ?? '#ffffff',
    fgColor: options.foregroundColor ?? undefined,
    dpr,
    config,
    assets,
    resources,
    spreads: buildSpreads(resources.pages, config, getChapterStartPages(resources.chapterMap)),
    spreadRenderedListeners: new Set(),
    fontSizeOverride: options.fontSize,
    lineHeightOverride: options.lineHeight,
    lineHeightForce: options.lineHeightForce ?? false,
    fontFamilyOverride: options.fontFamily,
    fontFamilyForce: options.fontFamilyForce ?? false,
  };
}

function normalizeLineBreaking(lineBreaking: ReaderOptions['lineBreaking']): 'greedy' | 'optimal' {
  return lineBreaking ?? 'greedy';
}
