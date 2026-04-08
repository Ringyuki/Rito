import type { LayoutConfig } from '../layout/core/types';
import type { ChapterRange } from '../runtime/types';
import type { SpineItem, PackageDocument } from '../parser/epub/types';
import type { DocumentNode, ElementAttributes } from '../parser/xhtml/types';
import type { LogLevel } from '../utils/logger';

export interface ChapterData {
  readonly nodes: readonly DocumentNode[];
  readonly bodyAttributes?: ElementAttributes;
}

/** Data sent from the main thread to the pagination worker. */
export interface PaginateRequest {
  readonly type: 'paginate';
  readonly config: LayoutConfig;
  /** Pre-parsed XHTML document nodes with body attributes, keyed by spine idref. */
  readonly chapters: ReadonlyMap<string, ChapterData>;
  /** Raw CSS stylesheet content, keyed by manifest id. */
  readonly stylesheets: ReadonlyMap<string, string>;
  /** Image dimensions for layout, keyed by href. */
  readonly imageSizes: ReadonlyMap<string, { width: number; height: number }>;
  /** Spine reading order. */
  readonly spine: readonly SpineItem[];
  /** Full package document for body style resolution. */
  readonly packageDocument: PackageDocument;
  /** Line-breaking algorithm. Defaults to 'greedy'. */
  readonly lineBreaking?: 'greedy' | 'optimal';
  /** Log verbosity for worker-side logging. Defaults to 'warn'. */
  readonly logLevel?: LogLevel;
}

/** Serializable pagination result sent from worker to main thread. */
export interface PaginateResponse {
  readonly type: 'result';
  readonly pages: readonly unknown[];
  readonly chapterMap: readonly [string, ChapterRange][];
  readonly anchorMap: readonly [string, number][];
}

export type WorkerMessage = PaginateRequest;
export type WorkerResponse = PaginateResponse | { type: 'error'; message: string };
