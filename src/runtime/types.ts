/**
 * Runtime types for high-level orchestration.
 * Handles document loading, resource management, and caching.
 */

import type { PackageDocument } from '../parser/epub/types';

/** Represents a loaded EPUB document ready for layout. */
export interface EpubDocument {
  readonly packageDocument: PackageDocument;
  readonly chapters: ReadonlyMap<string, string>;
}

/** Options for loading an EPUB file. */
export interface LoadOptions {
  readonly maxChapters?: number;
}
