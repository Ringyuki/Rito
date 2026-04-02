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
 * Paginate all chapters in an EPUB document into renderable pages.
 *
 * Processes each chapter in spine order: parses XHTML, resolves styles,
 * computes block and inline layout, then splits the result into pages.
 *
 * @param document - A loaded {@link EpubDocument} from {@link loadEpub}.
 * @param config - Page dimensions and margins.
 * @param measurer - A {@link TextMeasurer} for computing text widths.
 *   Create one with {@link createTextMeasurer} in browser environments.
 * @returns An array of {@link Page} objects ready for rendering.
 *
 * @example
 * ```ts
 * const measurer = createTextMeasurer(canvas);
 * const pages = paginate(doc, {
 *   pageWidth: 800, pageHeight: 1200,
 *   marginTop: 40, marginRight: 40, marginBottom: 40, marginLeft: 40,
 * }, measurer);
 * ```
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
