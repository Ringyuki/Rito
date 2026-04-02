import type { LayoutConfig, Page } from '../layout/types';
import type { TextMeasurer } from '../layout/text-measurer';
import type { ParagraphLayouter } from '../layout/paragraph-layouter';
import { createGreedyLayouter } from '../layout/greedy-line-breaker';
import { layoutBlocks } from '../layout/block-layout';
import { paginateBlocks } from '../layout/paginator';
import { parseXhtml } from '../parser/xhtml/xhtml-parser';
import { resolveStyles } from '../style/resolver';
import { parseCssRules } from '../style/css-rule-parser';
import { DEFAULT_STYLE } from '../style/defaults';
import type { ComputedStyle, CssRule } from '../style/types';
import type { EpubDocument } from './types';

/**
 * Paginate all chapters in an EPUB document into renderable pages.
 *
 * Each chapter starts on a new page. Parses and applies CSS stylesheets
 * from the EPUB, then processes each chapter in spine order.
 */
export function paginate(
  document: EpubDocument,
  config: LayoutConfig,
  measurer: TextMeasurer,
): readonly Page[] {
  const contentWidth = config.pageWidth - config.marginLeft - config.marginRight;
  const layouter: ParagraphLayouter = createGreedyLayouter(measurer);

  // Parse all stylesheets into CSS rules
  const allRules: CssRule[] = [];
  for (const css of document.stylesheets.values()) {
    const rules = parseCssRules(css, DEFAULT_STYLE.fontSize);
    allRules.push(...rules);
  }

  // Extract body/html level base style
  const bodyStyle = computeBodyStyle(allRules);

  const allPages: Page[] = [];

  for (const spineItem of document.packageDocument.spine) {
    const xhtml = document.chapters.get(spineItem.idref);
    if (!xhtml) continue;

    const { nodes } = parseXhtml(xhtml);
    const styled = resolveStyles(nodes, bodyStyle, allRules);
    const blocks = layoutBlocks(styled, contentWidth, layouter);
    if (blocks.length === 0) continue;

    const chapterPages = paginateBlocks(blocks, config);
    for (const page of chapterPages) {
      allPages.push({ ...page, index: allPages.length });
    }
  }

  return allPages;
}

function computeBodyStyle(rules: readonly CssRule[]): ComputedStyle {
  let style: ComputedStyle = DEFAULT_STYLE;
  for (const rule of rules) {
    if (rule.selector === 'body' || rule.selector === 'html') {
      style = { ...style, ...rule.declarations };
    }
  }
  return style;
}
