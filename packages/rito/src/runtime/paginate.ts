import type { LayoutBlock, LayoutConfig, Page } from '../layout/types';
import type { TextMeasurer } from '../layout/text-measurer';
import type { ParagraphLayouter } from '../layout/paragraph-layouter';
import type { ImageSizeMap } from '../layout/block-layout';
import { createGreedyLayouter } from '../layout/greedy-line-breaker';
import { layoutBlocks } from '../layout/block-layout';
import { paginateBlocks } from '../layout/paginator';
import { parseXhtml } from '../parser/xhtml/xhtml-parser';
import { resolveStyles } from '../style/resolver';
import { parseCssRules } from '../style/css-rule-parser';
import { DEFAULT_STYLE } from '../style/defaults';
import type { ComputedStyle, CssRule } from '../style/types';
import type { ChapterRange, EpubDocument, PaginationResult } from './types';

/**
 * Paginate all chapters in an EPUB document into renderable pages.
 *
 * @param document - A loaded EpubDocument.
 * @param config - Layout configuration.
 * @param measurer - Text measurer for line breaking.
 * @param images - Decoded image bitmaps for correct image sizing.
 */
export function paginate(
  document: EpubDocument,
  config: LayoutConfig,
  measurer: TextMeasurer,
  images?: ReadonlyMap<string, ImageBitmap>,
): readonly Page[] {
  return paginateWithMeta(document, config, measurer, images).pages;
}

/**
 * Paginate all chapters and return enriched metadata including chapter-to-page mapping.
 */
export function paginateWithMeta(
  document: EpubDocument,
  config: LayoutConfig,
  measurer: TextMeasurer,
  images?: ReadonlyMap<string, ImageBitmap>,
): PaginationResult {
  const contentWidth = config.pageWidth - config.marginLeft - config.marginRight;
  const contentHeight = config.pageHeight - config.marginTop - config.marginBottom;
  const layouter: ParagraphLayouter = createGreedyLayouter(measurer);

  const allRules: CssRule[] = [];
  for (const css of document.stylesheets.values()) {
    const rules = parseCssRules(css, DEFAULT_STYLE.fontSize);
    allRules.push(...rules);
  }

  const bodyStyle = computeBodyStyle(allRules);
  const imageSizes = images ? createImageSizeMap(images) : undefined;

  const allPages: Page[] = [];
  const chapterMap = new Map<string, ChapterRange>();
  const anchorMap = new Map<string, number>();

  for (const spineItem of document.packageDocument.spine) {
    const xhtml = document.chapters.get(spineItem.idref);
    if (!xhtml) continue;

    const { nodes } = parseXhtml(xhtml);
    const styled = resolveStyles(nodes, bodyStyle, allRules);
    const blocks = layoutBlocks(styled, contentWidth, layouter, imageSizes, contentHeight);
    if (blocks.length === 0) continue;

    const startPage = allPages.length;
    const chapterPages = paginateBlocks(blocks, config);
    for (const page of chapterPages) {
      const pageIndex = allPages.length;
      allPages.push({ ...page, index: pageIndex });
      collectAnchors(page.content, pageIndex, anchorMap);
    }
    chapterMap.set(spineItem.idref, { startPage, endPage: allPages.length - 1 });
  }

  return { pages: allPages, chapterMap, anchorMap };
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

function createImageSizeMap(images: ReadonlyMap<string, ImageBitmap>): ImageSizeMap {
  return {
    getSize(src: string) {
      // Direct match
      for (const [href, bitmap] of images) {
        if (src.endsWith(href) || href.endsWith(src)) {
          return { width: bitmap.width, height: bitmap.height };
        }
      }
      // Filename match
      const srcName = src.split('/').pop();
      if (srcName) {
        for (const [href, bitmap] of images) {
          if (href.split('/').pop() === srcName) {
            return { width: bitmap.width, height: bitmap.height };
          }
        }
      }
      return undefined;
    },
  };
}

/** Walk layout blocks on a page and record any anchor IDs. */
function collectAnchors(
  blocks: readonly LayoutBlock[],
  pageIndex: number,
  anchorMap: Map<string, number>,
): void {
  for (const block of blocks) {
    if (block.anchorId && !anchorMap.has(block.anchorId)) {
      anchorMap.set(block.anchorId, pageIndex);
    }
    // Recurse into nested blocks
    for (const child of block.children) {
      if (child.type === 'layout-block') {
        collectAnchors([child], pageIndex, anchorMap);
      }
    }
  }
}
