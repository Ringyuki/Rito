import type { LayoutConfig, Page } from '../layout/types';
import type { TextMeasurer } from '../layout/text-measurer';
import { parseXhtml } from '../parser/xhtml/xhtml-parser';
import type { Logger } from '../utils/logger';
import { createLogger } from '../utils/logger';
import {
  paginateChapterNodes,
  preparePaginationContext,
  type PreparedPaginationContext,
} from './pagination-core';
import type { ChapterRange, EpubDocument, PaginationResult } from './types';
import { logXhtmlWarnings } from './xhtml-diagnostics';

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
  private readonly context: PreparedPaginationContext;
  private readonly logger: Logger;

  private spineIndex = 0;
  private readonly allPages: Page[] = [];
  private readonly chapterMap = new Map<string, ChapterRange>();
  private readonly anchorMap = new Map<string, number>();

  constructor(
    doc: EpubDocument,
    config: LayoutConfig,
    measurer: TextMeasurer,
    images?: ReadonlyMap<string, ImageBitmap>,
    lineBreaking?: 'greedy' | 'optimal',
    logger?: Logger,
  ) {
    this.logger = logger ?? createLogger();
    this.doc = doc;
    this.config = config;
    this.context = preparePaginationContext(
      config,
      measurer,
      doc.stylesheets,
      images,
      lineBreaking,
    );
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

      const { nodes, warnings } = parseXhtml(xhtml);
      logXhtmlWarnings(warnings, this.logger, spineItem.idref);
      const startPage = this.allPages.length;
      const chapter = paginateChapterNodes(nodes, this.config, this.context, startPage);
      if (chapter.pages.length === 0) continue;

      this.logger.debug('Chapter %s: %d blocks laid out', spineItem.idref, chapter.blockCount);

      const newPages = [...chapter.pages];
      this.allPages.push(...newPages);
      mergeAnchorMap(this.anchorMap, chapter.anchorMap);
      this.chapterMap.set(spineItem.idref, { startPage, endPage: this.allPages.length - 1 });
      this.logger.info('Chapter paginated: %s -> %d pages', spineItem.idref, newPages.length);

      return { pages: newPages, done: this.spineIndex >= spine.length };
    }

    return { pages: [], done: true };
  }

  /** Paginate all remaining chapters at once. Returns the complete result. */
  paginateAll(): PaginationResult {
    while (this.spineIndex < this.doc.packageDocument.spine.length) {
      this.paginateNextChapter();
    }
    this.logger.info('Pagination complete: %d total pages', this.allPages.length);
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

function mergeAnchorMap(target: Map<string, number>, source: ReadonlyMap<string, number>): void {
  for (const [anchorId, pageIndex] of source) {
    if (!target.has(anchorId)) {
      target.set(anchorId, pageIndex);
    }
  }
}
