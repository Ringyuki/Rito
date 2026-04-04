import { buildSpreads } from '../../layout/spread';
import {
  loadAssets,
  paginateWithAssets,
  type LoadedAssets,
  type Resources,
} from '../../render/assets';
import type { ReaderOptions } from '../../reader';
import type { EpubDocument } from '../../runtime/types';
import type { LogLevel } from '../../utils/logger';
import { createLogger } from '../../utils/logger';
import { getWorkerModuleUrl } from '../../worker-module-url';
import { paginateInWorker } from '../../workers/worker-paginator';
import { getChapterStartPages, makeLayoutConfig } from './layout-utils';
import type { ReaderState } from './types';

export async function initReaderState(
  doc: EpubDocument,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: ReaderOptions,
): Promise<ReaderState> {
  const logger = createLogger(options.logLevel ?? 'warn');
  const spreadMode = options.spread ?? 'single';
  const dpr =
    options.devicePixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1);
  const config = makeLayoutConfig(options, spreadMode);
  const assets = await loadAssets(doc, canvas, logger);
  const paginationResult = options.useWorker
    ? await paginateViaWorker(doc, config, assets, options.lineBreaking, options.logLevel)
    : paginateWithAssets(doc, config, assets, options.lineBreaking, logger);
  const resources: Resources = { ...paginationResult, images: assets.images };

  logger.info('Reader created: %dx%d, spread=%s', options.width, options.height, spreadMode);
  return {
    logger,
    spreadMode,
    bgColor: options.backgroundColor ?? '#ffffff',
    fgColor: options.foregroundColor,
    dpr,
    config,
    assets,
    resources,
    spreads: buildSpreads(resources.pages, config, getChapterStartPages(resources.chapterMap)),
    spreadRenderedListeners: new Set(),
    fontSizeOverride: undefined,
  };
}

async function paginateViaWorker(
  doc: EpubDocument,
  config: ReaderState['config'],
  assets: LoadedAssets,
  lineBreaking?: 'greedy' | 'optimal',
  logLevel?: LogLevel,
): Promise<Omit<Resources, 'images'>> {
  const worker = new Worker(getWorkerModuleUrl(), { type: 'module' });
  try {
    return await paginateInWorker(worker, doc, config, assets, lineBreaking, logLevel);
  } finally {
    worker.terminate();
  }
}
