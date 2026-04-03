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

/** Result of paginating a single chapter. */
export interface ChapterPaginationResult {
  readonly pages: readonly Page[];
  readonly done: boolean;
}

/**
 * Paginates one chapter at a time. Use `paginateNextChapter()` for
 * incremental loading, or `paginateAll()` to process everything at once.
 */
export class PaginationSession {
  private readonly doc: EpubDocument;
  private readonly config: LayoutConfig;
  private readonly layouter: ParagraphLayouter;
  private readonly imageSizes: ImageSizeMap | undefined;
  private readonly contentWidth: number;
  private readonly contentHeight: number;
  private readonly allRules: readonly CssRule[];
  private readonly bodyStyle: ComputedStyle;

  private spineIndex = 0;
  private readonly allPages: Page[] = [];
  private readonly chapterMap = new Map<string, ChapterRange>();
  private readonly anchorMap = new Map<string, number>();

  constructor(
    doc: EpubDocument,
    config: LayoutConfig,
    measurer: TextMeasurer,
    images?: ReadonlyMap<string, ImageBitmap>,
  ) {
    this.doc = doc;
    this.config = config;
    this.contentWidth = config.pageWidth - config.marginLeft - config.marginRight;
    this.contentHeight = config.pageHeight - config.marginTop - config.marginBottom;
    this.layouter = createGreedyLayouter(measurer);

    const rules: CssRule[] = [];
    for (const css of doc.stylesheets.values()) {
      rules.push(...parseCssRules(css, DEFAULT_STYLE.fontSize));
    }
    this.allRules = rules;
    this.bodyStyle = computeBodyStyle(rules);
    this.imageSizes = images ? createImageSizeMap(images) : undefined;
  }

  /** Paginate the next spine item. Returns the new pages and whether all chapters are done. */
  paginateNextChapter(): ChapterPaginationResult {
    const spine = this.doc.packageDocument.spine;

    while (this.spineIndex < spine.length) {
      const spineItem = spine[this.spineIndex];
      this.spineIndex++;
      if (!spineItem) continue;

      const xhtml = this.doc.readChapter(spineItem.idref);
      if (!xhtml) continue;

      const { nodes } = parseXhtml(xhtml);
      const styled = resolveStyles(nodes, this.bodyStyle, this.allRules);
      const blocks = layoutBlocks(
        styled,
        this.contentWidth,
        this.layouter,
        this.imageSizes,
        this.contentHeight,
      );
      if (blocks.length === 0) continue;

      const startPage = this.allPages.length;
      const chapterPages = paginateBlocks(blocks, this.config);
      const newPages: Page[] = [];
      for (const page of chapterPages) {
        const pageIndex = this.allPages.length;
        const indexed = { ...page, index: pageIndex };
        this.allPages.push(indexed);
        newPages.push(indexed);
        collectAnchors(page.content, pageIndex, this.anchorMap);
      }
      this.chapterMap.set(spineItem.idref, { startPage, endPage: this.allPages.length - 1 });

      return { pages: newPages, done: this.spineIndex >= spine.length };
    }

    return { pages: [], done: true };
  }

  /** Paginate all remaining chapters at once. Returns the complete result. */
  paginateAll(): PaginationResult {
    while (this.spineIndex < this.doc.packageDocument.spine.length) {
      this.paginateNextChapter();
    }
    return this.getResult();
  }

  /** Get all pages paginated so far. */
  getCurrentPages(): readonly Page[] {
    return this.allPages;
  }

  /** Get the current chapter-to-page mapping. */
  getChapterMap(): ReadonlyMap<string, ChapterRange> {
    return this.chapterMap;
  }

  /** Get the full pagination result (pages + chapterMap + anchorMap). */
  getResult(): PaginationResult {
    return {
      pages: this.allPages,
      chapterMap: this.chapterMap,
      anchorMap: this.anchorMap,
    };
  }
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
      for (const [href, bitmap] of images) {
        if (src.endsWith(href) || href.endsWith(src)) {
          return { width: bitmap.width, height: bitmap.height };
        }
      }
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
