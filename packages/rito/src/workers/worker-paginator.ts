import type { LayoutConfig, Page } from '../layout/types';
import type { EpubDocument, PaginationResult } from '../runtime/types';
import { logXhtmlWarnings } from '../runtime/xhtml-diagnostics';
import type { LoadedAssets } from '../render/resources';
import { createLogger, type LogLevel, type Logger } from '../utils/logger';
import type { DocumentNode } from '../parser/xhtml/types';
import { parseXhtml } from '../parser/xhtml/xhtml-parser';
import type { PaginateRequest, WorkerResponse } from './types';

/**
 * Run pagination in a Web Worker using the provided Worker instance.
 *
 * The caller is responsible for creating the Worker from the pagination-worker entry.
 * This function pre-reads all chapters, extracts image sizes, and posts
 * the data to the Worker for off-main-thread processing.
 */
export function paginateInWorker(
  worker: Worker,
  doc: EpubDocument,
  config: LayoutConfig,
  assets: LoadedAssets,
  lineBreaking?: 'greedy' | 'optimal',
  logLevel?: LogLevel,
): Promise<PaginationResult> {
  return new Promise((resolve, reject) => {
    const logger = createLogger(logLevel ?? 'warn');
    const chapters = preReadAndParseChapters(doc, logger);
    const imageSizes = extractImageSizes(assets.images);

    const request: PaginateRequest = {
      type: 'paginate',
      config,
      chapters,
      stylesheets: doc.stylesheets,
      imageSizes,
      spine: doc.packageDocument.spine,
      packageDocument: doc.packageDocument,
      ...(lineBreaking ? { lineBreaking } : {}),
      ...(logLevel ? { logLevel } : {}),
    };

    worker.onmessage = (e: MessageEvent) => {
      const response = e.data as WorkerResponse;
      if (response.type === 'result') {
        resolve({
          pages: response.pages as Page[],
          chapterMap: new Map(response.chapterMap),
          anchorMap: new Map(response.anchorMap),
        });
      } else {
        reject(new Error(response.message));
      }
    };

    worker.onerror = (e) => {
      reject(new Error(e.message));
    };

    worker.postMessage(request);
  });
}

function preReadAndParseChapters(
  doc: EpubDocument,
  logger: Logger,
): Map<string, readonly DocumentNode[]> {
  const chapters = new Map<string, readonly DocumentNode[]>();
  for (const item of doc.packageDocument.spine) {
    const xhtml = doc.readChapter(item.idref);
    if (xhtml) {
      const { nodes, warnings } = parseXhtml(xhtml);
      logXhtmlWarnings(warnings, logger, item.idref);
      chapters.set(item.idref, nodes);
    }
  }
  return chapters;
}

function extractImageSizes(
  images: ReadonlyMap<string, ImageBitmap>,
): Map<string, { width: number; height: number }> {
  const sizes = new Map<string, { width: number; height: number }>();
  for (const [href, bitmap] of images) {
    sizes.set(href, { width: bitmap.width, height: bitmap.height });
  }
  return sizes;
}
