import type { LayoutConfig } from '../layout/types';
import type { ChapterRange } from '../runtime/types';
import type { SpineItem, PackageDocument } from '../parser/epub/types';

/** Data sent from the main thread to the pagination worker. */
export interface PaginateRequest {
  readonly type: 'paginate';
  readonly config: LayoutConfig;
  /** Pre-read XHTML content, keyed by spine idref. */
  readonly chapters: ReadonlyMap<string, string>;
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
