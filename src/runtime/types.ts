import type { PackageDocument } from '../parser/epub/types';

/** Represents a loaded EPUB document ready for layout. */
export interface EpubDocument {
  readonly packageDocument: PackageDocument;
  /** Map from spine item idref to XHTML chapter content string. */
  readonly chapters: ReadonlyMap<string, string>;
}

/** Options for loading an EPUB file. */
export interface LoadOptions {
  readonly maxChapters?: number;
}
