import type { Page } from '../layout/types';
import type { ImageSizeMap } from '../layout/block-layout';
import { createGreedyLayouter } from '../layout/greedy-line-breaker';
import { layoutBlocks } from '../layout/block-layout';
import { paginateBlocks } from '../layout/paginator';
import { parseXhtml } from '../parser/xhtml/xhtml-parser';
import { resolveStyles } from '../style/resolver';
import { parseCssRules } from '../style/css-rule-parser';
import { DEFAULT_STYLE } from '../style/defaults';
import type { ComputedStyle, CssRule } from '../style/types';
import { createCanvasTextMeasurer } from '../render/canvas-text-measurer';
import type { PaginateRequest, WorkerResponse } from './types';

/** Handle a pagination request. Exported for use in Worker entry. */
export function handlePaginate(req: PaginateRequest): WorkerResponse {
  const canvas = new OffscreenCanvas(1, 1);
  const ctx = canvas.getContext('2d');
  if (!ctx) return { type: 'error', message: 'Failed to get OffscreenCanvas 2d context' };

  const measurer = createCanvasTextMeasurer(ctx as unknown as CanvasRenderingContext2D);
  const layouter = createGreedyLayouter(measurer);

  const rules = buildRules(req.stylesheets);
  const bodyStyle = computeBodyStyle(rules);
  const imageSizes = buildImageSizeMap(req.imageSizes);

  const contentWidth = req.config.pageWidth - req.config.marginLeft - req.config.marginRight;
  const contentHeight = req.config.pageHeight - req.config.marginTop - req.config.marginBottom;

  const allPages: Page[] = [];
  const chapterMap: [string, { startPage: number; endPage: number }][] = [];
  const anchorMap = new Map<string, number>();

  for (const spineItem of req.spine) {
    const xhtml = req.chapters.get(spineItem.idref);
    if (!xhtml) continue;

    const { nodes } = parseXhtml(xhtml);
    const styled = resolveStyles(nodes, bodyStyle, rules);
    const blocks = layoutBlocks(styled, contentWidth, layouter, imageSizes, contentHeight);
    if (blocks.length === 0) continue;

    const startPage = allPages.length;
    const pages = paginateBlocks(blocks, req.config);
    for (const page of pages) {
      const idx = allPages.length;
      allPages.push({ ...page, index: idx });
      collectAnchors(page.content, idx, anchorMap);
    }
    chapterMap.push([spineItem.idref, { startPage, endPage: allPages.length - 1 }]);
  }

  return {
    type: 'result',
    pages: allPages,
    chapterMap,
    anchorMap: Array.from(anchorMap.entries()),
  };
}

function buildRules(stylesheets: ReadonlyMap<string, string>): CssRule[] {
  const rules: CssRule[] = [];
  for (const css of stylesheets.values()) {
    rules.push(...parseCssRules(css, DEFAULT_STYLE.fontSize));
  }
  return rules;
}

function computeBodyStyle(rules: readonly CssRule[]): ComputedStyle {
  let style: ComputedStyle = DEFAULT_STYLE;
  for (const rule of rules) {
    if (rule.selector === 'body' || rule.selector === 'html') {
      style = { ...style, ...rule.declarations };
    }
  }
  return style;
}

function buildImageSizeMap(
  sizes: ReadonlyMap<string, { width: number; height: number }>,
): ImageSizeMap {
  return {
    getSize(src: string) {
      for (const [href, size] of sizes) {
        if (src.endsWith(href) || href.endsWith(src)) return size;
      }
      const srcName = src.split('/').pop();
      if (srcName) {
        for (const [href, size] of sizes) {
          if (href.split('/').pop() === srcName) return size;
        }
      }
      return undefined;
    },
  };
}

import type { LayoutBlock } from '../layout/types';

function collectAnchors(
  blocks: readonly LayoutBlock[],
  pageIndex: number,
  anchorMap: Map<string, number>,
): void {
  for (const block of blocks) {
    if (block.anchorId && !anchorMap.has(block.anchorId)) {
      anchorMap.set(block.anchorId, pageIndex);
    }
    for (const child of block.children) {
      if (child.type === 'layout-block') {
        collectAnchors([child], pageIndex, anchorMap);
      }
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
