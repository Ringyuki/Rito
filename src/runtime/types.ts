import type { PackageDocument } from '../parser/epub/types';

/**
 * A loaded EPUB document ready for pagination.
 *
 * Contains the parsed package metadata (title, author, manifest, spine)
 * and all chapter XHTML content eagerly loaded into memory.
 */
export interface EpubDocument {
  /** The parsed OPF package document (metadata, manifest, spine). */
  readonly packageDocument: PackageDocument;
  /** Map from spine item idref to XHTML chapter content string. */
  readonly chapters: ReadonlyMap<string, string>;
  /** Map from manifest item id to raw CSS stylesheet content. */
  readonly stylesheets: ReadonlyMap<string, string>;
}

/**
 * Options for {@link loadEpub}.
 */
export interface LoadOptions {
  /** Maximum number of spine chapters to load. Defaults to all. */
  readonly maxChapters?: number;
}
