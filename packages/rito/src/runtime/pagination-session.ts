import type { ImageDimensions, LayoutConfig, Page } from '../layout/core/types';
import type { TextMeasurer } from '../layout/text/text-measurer';
import type { DocumentNode } from '../parser/xhtml/types';
import { parseXhtml } from '../parser/xhtml/xhtml-parser';
import type { Logger } from '../utils/logger';
import { createLogger } from '../utils/logger';
import {
  paginateChapterNodes,
  preparePaginationContext,
  type PreparedPaginationContext,
} from './pagination-core';
import type { ChapterRange, EpubDocument, PaginationResult } from './types';
import type { ChapterTextIndex } from '../interaction/anchors/chapter-text-index';
import { buildChapterTextIndex } from '../interaction/anchors/chapter-text-index';
import {
  buildManifestHrefMap,
  extractAllFootnotes,
  extractChapterFootnotes,
  type FootnoteEntry,
  type ManifestHrefMap,
} from './footnote-extractor';
import { logXhtmlWarnings } from './xhtml-diagnostics';

type BodyAttributes = { readonly class?: string; readonly style?: string };

interface ChapterSources {
  readonly nodesByIdref: ReadonlyMap<string, readonly DocumentNode[]>;
  readonly bodyAttrsByIdref: ReadonlyMap<string, BodyAttributes>;
  readonly stylesheetHrefsByIdref: ReadonlyMap<string, readonly string[]>;
}

/** Result of paginating a single chapter. */
export interface ChapterPaginationResult {
  readonly pages: readonly Page[];
  readonly done: boolean;
}

/**
 * Paginates one chapter at a time. Use `paginateNextChapter()` for
 * incremental loading, or `paginateAll()` to process everything at once.
 *
 * `paginateAll()` pre-scans ALL chapters for cross-document footnote support.
 * `paginateNextChapter()` only handles same-chapter footnotes.
 */
export class PaginationSession {
  private readonly doc: EpubDocument;
  private readonly config: LayoutConfig;
  private readonly context: PreparedPaginationContext;
  private readonly logger: Logger;
  private readonly hrefMap: ManifestHrefMap;

  private spineIndex = 0;
  private readonly allPages: Page[] = [];
  private readonly chapterMap = new Map<string, ChapterRange>();
  private readonly anchorMap = new Map<string, number>();
  private readonly chapterTextIndices = new Map<string, ChapterTextIndex>();
  private readonly footnoteMap = new Map<string, FootnoteEntry>();

  constructor(
    doc: EpubDocument,
    config: LayoutConfig,
    measurer: TextMeasurer,
    images?: ReadonlyMap<string, ImageDimensions>,
    lineBreaking?: 'greedy' | 'optimal',
    logger?: Logger,
  ) {
    this.logger = logger ?? createLogger();
    this.doc = doc;
    this.config = config;
    this.hrefMap = buildManifestHrefMap(doc.packageDocument.manifest, doc.packageDocument.spine);
    this.context = preparePaginationContext(
      config,
      measurer,
      doc.stylesheets,
      images,
      lineBreaking,
    );
  }

  /**
   * Paginate the next spine item (incremental path).
   * Only same-chapter footnotes are extracted. For full cross-document support,
   * use `paginateAll()` which pre-scans all chapters.
   */
  paginateNextChapter(): ChapterPaginationResult {
    const spine = this.doc.packageDocument.spine;

    while (this.spineIndex < spine.length) {
      const spineItem = spine[this.spineIndex];
      this.spineIndex++;
      if (!spineItem) continue;

      const xhtml = this.doc.readChapter(spineItem.idref);
      if (!xhtml) continue;

      const { nodes: rawNodes, warnings, bodyAttributes, stylesheetHrefs } = parseXhtml(xhtml);
      logXhtmlWarnings(warnings, this.logger, spineItem.idref);
      const chapterHref = this.hrefMap.get(spineItem.idref) ?? spineItem.idref;
      const { filtered: nodes, footnotes } = extractChapterFootnotes(rawNodes, chapterHref);
      for (const [key, entry] of footnotes) this.footnoteMap.set(key, entry);
      this.chapterTextIndices.set(spineItem.idref, buildChapterTextIndex(spineItem.idref, nodes));

      const startPage = this.allPages.length;
      const chapter = paginateChapterNodes(
        nodes,
        this.config,
        this.context,
        startPage,
        bodyAttributes,
        stylesheetHrefs,
      );
      if (chapter.pages.length === 0) continue;

      this.logger.debug('Chapter %s: %d blocks laid out', spineItem.idref, chapter.blockCount);
      const newPages = [...chapter.pages];
      this.allPages.push(...newPages);
      mergeAnchorMap(this.anchorMap, chapter.anchorMap);
      this.chapterMap.set(spineItem.idref, { startPage, endPage: this.allPages.length - 1 });

      return { pages: newPages, done: this.spineIndex >= spine.length };
    }

    return { pages: [], done: true };
  }

  /**
   * Paginate all chapters at once with full cross-document footnote support.
   * Resets any prior incremental state from `paginateNextChapter()` to ensure
   * consistent results — all chapters are (re-)paginated from scratch.
   */
  paginateAll(): PaginationResult {
    this.resetPaginationState();
    const spine = this.doc.packageDocument.spine;
    const sources = this.collectChapterSources();
    const { filteredChapters, footnotes } = extractAllFootnotes(sources.nodesByIdref, this.hrefMap);
    for (const [key, entry] of footnotes) this.footnoteMap.set(key, entry);
    this.paginateFilteredChapters(spine, filteredChapters, sources);

    this.logger.info('Pagination complete: %d total pages', this.allPages.length);
    return this.getResult();
  }

  private resetPaginationState(): void {
    this.spineIndex = 0;
    this.allPages.length = 0;
    this.chapterMap.clear();
    this.anchorMap.clear();
    this.chapterTextIndices.clear();
    this.footnoteMap.clear();
  }

  private collectChapterSources(): ChapterSources {
    const nodesByIdref = new Map<string, readonly DocumentNode[]>();
    const bodyAttrsByIdref = new Map<string, BodyAttributes>();
    const stylesheetHrefsByIdref = new Map<string, readonly string[]>();

    for (const item of this.doc.packageDocument.spine) {
      const xhtml = this.doc.readChapter(item.idref);
      if (!xhtml) continue;
      const { nodes, warnings, bodyAttributes, stylesheetHrefs } = parseXhtml(xhtml);
      logXhtmlWarnings(warnings, this.logger, item.idref);
      nodesByIdref.set(item.idref, nodes);
      if (bodyAttributes) bodyAttrsByIdref.set(item.idref, bodyAttributes);
      if (stylesheetHrefs) stylesheetHrefsByIdref.set(item.idref, stylesheetHrefs);
    }

    return { nodesByIdref, bodyAttrsByIdref, stylesheetHrefsByIdref };
  }

  private paginateFilteredChapters(
    spine: EpubDocument['packageDocument']['spine'],
    filteredChapters: ReadonlyMap<string, readonly DocumentNode[]>,
    sources: ChapterSources,
  ): void {
    for (const item of spine) {
      this.spineIndex++;
      const nodes = filteredChapters.get(item.idref);
      if (!nodes || nodes.length === 0) continue;

      this.chapterTextIndices.set(item.idref, buildChapterTextIndex(item.idref, nodes));
      const startPage = this.allPages.length;
      const bodyAttributes = sources.bodyAttrsByIdref.get(item.idref);
      const chapterStylesheetHrefs = sources.stylesheetHrefsByIdref.get(item.idref);
      const chapter = paginateChapterNodes(
        nodes,
        this.config,
        this.context,
        startPage,
        bodyAttributes,
        chapterStylesheetHrefs,
      );
      if (chapter.pages.length === 0) continue;

      this.allPages.push(...chapter.pages);
      mergeAnchorMap(this.anchorMap, chapter.anchorMap);
      this.chapterMap.set(item.idref, { startPage, endPage: this.allPages.length - 1 });
    }
  }

  getCurrentPages(): readonly Page[] {
    return this.allPages;
  }

  getChapterMap(): ReadonlyMap<string, ChapterRange> {
    return this.chapterMap;
  }

  getResult(): PaginationResult {
    return {
      pages: this.allPages,
      chapterMap: this.chapterMap,
      anchorMap: this.anchorMap,
      chapterTextIndices: this.chapterTextIndices,
      footnoteMap: this.footnoteMap,
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
