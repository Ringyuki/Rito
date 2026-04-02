import type { LayoutConfig, Page } from '../layout/types';
import type { TextMeasurer } from '../layout/text-measurer';
import type { ParagraphLayouter } from '../layout/paragraph-layouter';
import { createGreedyLayouter } from '../layout/greedy-line-breaker';
import { layoutBlocks } from '../layout/block-layout';
import { paginateBlocks } from '../layout/paginator';
import { parseXhtml } from '../parser/xhtml/xhtml-parser';
import { resolveStyles } from '../style/resolver';
import type { EpubDocument } from './types';

/**
 * Paginate all chapters in an EPUB document into pages.
 *
 * Orchestrates XHTML parsing → style resolution → block layout → pagination
 * for each chapter in spine order.
 */
export function paginate(
  document: EpubDocument,
  config: LayoutConfig,
  measurer: TextMeasurer,
): readonly Page[] {
  const contentWidth = config.pageWidth - config.marginLeft - config.marginRight;
  const layouter: ParagraphLayouter = createGreedyLayouter(measurer);

  const allBlocks = [];

  for (const spineItem of document.packageDocument.spine) {
    const xhtml = document.chapters.get(spineItem.idref);
    if (!xhtml) continue;

    const { nodes } = parseXhtml(xhtml);
    const styled = resolveStyles(nodes);
    const blocks = layoutBlocks(styled, contentWidth, layouter);
    allBlocks.push(...blocks);
  }

  return paginateBlocks(allBlocks, config);
}
