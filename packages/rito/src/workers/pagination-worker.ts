import type { Page } from '../layout/core/types';
import { createCanvasTextMeasurer } from '../render/canvas-text-measurer';
import {
  paginateChapterNodes,
  preparePaginationContext,
  type PreparedPaginationContext,
} from '../runtime/pagination-core';
import { createLogger } from '../utils/logger';
import type { PaginateRequest, WorkerResponse } from './types';

/** Handle a pagination request. Exported for use in Worker entry. */
export function handlePaginate(req: PaginateRequest): WorkerResponse {
  const logger = createLogger(req.logLevel ?? 'warn');
  logger.info('Worker pagination: %d spine items', req.spine.length);

  const canvas = new OffscreenCanvas(1, 1);
  const ctx = canvas.getContext('2d');
  if (!ctx) return { type: 'error', message: 'Failed to get OffscreenCanvas 2d context' };

  const measurer = createCanvasTextMeasurer(ctx as unknown as CanvasRenderingContext2D);
  const context = preparePaginationContext(
    req.config,
    measurer,
    req.stylesheets,
    req.imageSizes,
    req.lineBreaking,
  );
  const { allPages, chapterMap, anchorMap } = paginateSpine(req, context);

  logger.info('Worker pagination complete: %d pages', allPages.length);

  return {
    type: 'result',
    pages: allPages,
    chapterMap,
    anchorMap: Array.from(anchorMap.entries()),
  };
}

function paginateSpine(
  req: PaginateRequest,
  context: PreparedPaginationContext,
): {
  allPages: Page[];
  chapterMap: [string, { startPage: number; endPage: number }][];
  anchorMap: Map<string, number>;
} {
  const allPages: Page[] = [];
  const chapterMap: [string, { startPage: number; endPage: number }][] = [];
  const anchorMap = new Map<string, number>();

  for (const spineItem of req.spine) {
    const nodes = req.chapters.get(spineItem.idref);
    if (!nodes || nodes.length === 0) continue;

    const startPage = allPages.length;
    const chapter = paginateChapterNodes(nodes, req.config, context, startPage);
    if (chapter.pages.length === 0) continue;

    allPages.push(...chapter.pages);
    mergeAnchorMap(anchorMap, chapter.anchorMap);
    chapterMap.push([spineItem.idref, { startPage, endPage: allPages.length - 1 }]);
  }

  return { allPages, chapterMap, anchorMap };
}

function mergeAnchorMap(target: Map<string, number>, source: ReadonlyMap<string, number>): void {
  for (const [anchorId, pageIndex] of source) {
    if (!target.has(anchorId)) {
      target.set(anchorId, pageIndex);
    }
  }
}

/** Register the Worker message handler. Called when this module is loaded as a Worker. */
export function initWorker(): void {
  const scope = globalThis as unknown as { onmessage: ((e: MessageEvent) => void) | null };
  scope.onmessage = (e: MessageEvent) => {
    const msg = e.data as PaginateRequest;
    if ((msg.type as string) === 'paginate') {
      try {
        const result = handlePaginate(msg);
        postMessage(result);
      } catch (err) {
        postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    }
  };
}
