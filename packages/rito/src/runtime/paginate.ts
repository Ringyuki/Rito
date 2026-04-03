import type { LayoutConfig, Page } from '../layout/types';
import type { TextMeasurer } from '../layout/text-measurer';
import type { EpubDocument, PaginationResult } from './types';
import { PaginationSession } from './pagination-session';

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
  lineBreaking?: 'greedy' | 'optimal',
): readonly Page[] {
  return paginateWithMeta(document, config, measurer, images, lineBreaking).pages;
}

/**
 * Paginate all chapters and return enriched metadata including chapter-to-page mapping.
 */
export function paginateWithMeta(
  document: EpubDocument,
  config: LayoutConfig,
  measurer: TextMeasurer,
  images?: ReadonlyMap<string, ImageBitmap>,
  lineBreaking?: 'greedy' | 'optimal',
): PaginationResult {
  const session = new PaginationSession(document, config, measurer, images, lineBreaking);
  return session.paginateAll();
}
