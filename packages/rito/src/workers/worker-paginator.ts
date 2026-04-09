import type { LayoutConfig, Page } from '../layout/core/types';
import type { EpubDocument, PaginationResult } from '../runtime/types';
import { logXhtmlWarnings } from '../runtime/xhtml-diagnostics';
import type { LoadedAssets } from '../render/assets';
import { createLogger, type LogLevel, type Logger } from '../utils/logger';
import { parseXhtml } from '../parser/xhtml/xhtml-parser';
import { buildChapterTextIndex } from '../interaction/anchors/chapter-text-index';
import type { ChapterTextIndex } from '../interaction/anchors/chapter-text-index';
import {
  buildManifestHrefMap,
  extractAllFootnotes,
  type FootnoteEntry,
} from '../runtime/footnote-extractor';
import type { DocumentNode } from '../parser/xhtml/types';
import type { ChapterData, PaginateRequest, WorkerResponse } from './types';

/**
 * Run pagination in a Web Worker using the provided Worker instance.
 *
 * The caller is responsible for creating the Worker from the pagination-worker entry.
 * This function pre-reads all chapters, extracts footnotes and image sizes, and posts
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
    const { chapters, textIndices, footnoteMap } = preReadAndParseChapters(doc, logger);
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
          chapterTextIndices: textIndices,
          footnoteMap,
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
): {
  chapters: Map<string, ChapterData>;
  textIndices: Map<string, ChapterTextIndex>;
  footnoteMap: Map<string, FootnoteEntry>;
} {
  const rawNodesByIdref = new Map<string, readonly DocumentNode[]>();
  const bodyAttrsByIdref = new Map<string, ChapterData['bodyAttributes']>();

  // Phase 1: Parse all chapters
  for (const item of doc.packageDocument.spine) {
    const xhtml = doc.readChapter(item.idref);
    if (xhtml) {
      const { nodes, warnings, bodyAttributes } = parseXhtml(xhtml);
      logXhtmlWarnings(warnings, logger, item.idref);
      rawNodesByIdref.set(item.idref, nodes);
      if (bodyAttributes) bodyAttrsByIdref.set(item.idref, bodyAttributes);
    }
  }

  // Phase 2: Full-book footnote extraction (consistent with main-thread paginateAll)
  const hrefMap = buildManifestHrefMap(doc.packageDocument.manifest, doc.packageDocument.spine);
  const { filteredChapters, footnotes } = extractAllFootnotes(rawNodesByIdref, hrefMap);

  // Phase 3: Build chapter data and text indices from filtered nodes
  const chapters = new Map<string, ChapterData>();
  const textIndices = new Map<string, ChapterTextIndex>();
  for (const item of doc.packageDocument.spine) {
    const nodes = filteredChapters.get(item.idref);
    if (!nodes) continue;
    const bodyAttributes = bodyAttrsByIdref.get(item.idref);
    chapters.set(item.idref, bodyAttributes ? { nodes, bodyAttributes } : { nodes });
    textIndices.set(item.idref, buildChapterTextIndex(item.idref, nodes));
  }

  return { chapters, textIndices, footnoteMap: footnotes };
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
