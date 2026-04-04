import type { Page } from '../layout/core/types';
import type { PackageDocument, TocEntry } from '../parser/epub/types';
import type { Logger } from '../utils/logger';

/**
 * A loaded EPUB document ready for pagination.
 *
 * Chapters are loaded lazily — call {@link readChapter} to retrieve
 * XHTML content for a spine item on demand.
 */
export interface EpubDocument {
  /** The parsed OPF package document (metadata, manifest, spine). */
  readonly packageDocument: PackageDocument;
  /** Read a chapter's XHTML content by spine item idref. Returns undefined if not found. */
  readChapter(idref: string): string | undefined;
  /** Map from manifest item id to raw CSS stylesheet content. */
  readonly stylesheets: ReadonlyMap<string, string>;
  /** Map from relative href to font binary data. */
  readonly fonts: ReadonlyMap<string, Uint8Array>;
  /** Map from relative href to image binary data. */
  readonly images: ReadonlyMap<string, Uint8Array>;
  /** Parsed table of contents, if available. */
  readonly toc: readonly TocEntry[];
  /** Release the underlying ZIP archive resources. */
  close(): void;
}

/** Page range for a single chapter/spine item. */
export interface ChapterRange {
  readonly startPage: number;
  readonly endPage: number;
}

/** Enriched pagination result with chapter mapping and anchors. */
export interface PaginationResult {
  readonly pages: readonly Page[];
  /** Map from spine item idref to page range. */
  readonly chapterMap: ReadonlyMap<string, ChapterRange>;
  /** Map from fragment identifier (id attribute) to page index. */
  readonly anchorMap: ReadonlyMap<string, number>;
}

/**
 * Options for {@link loadEpub}.
 */
export interface LoadOptions {
  /** Maximum number of spine chapters to load. Defaults to all. */
  readonly maxChapters?: number;
  /** Optional logger instance. Defaults to a warn-level logger. */
  readonly logger?: Logger;
}
