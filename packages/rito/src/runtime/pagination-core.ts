import type { ImageSizeMap } from '../layout/block';
import { layoutBlocks } from '../layout/block';
import { createGreedyLayouter, createKnuthPlassLayouter } from '../layout/line-breaker';
import { paginateBlocks } from '../layout/pagination';
import type { ImageDimensions, LayoutBlock, LayoutConfig, Page } from '../layout/core/types';
import type { ParagraphLayouter } from '../layout/text/paragraph-layouter';
import type { TextMeasurer } from '../layout/text/text-measurer';
import type { DocumentNode, ElementAttributes } from '../parser/xhtml/types';
import { resolveStyles } from '../style/cascade/resolver';
import type { ComputedStyle, CssRule, StyledNode } from '../style/core/types';
import type { Viewport } from '../style/css/parse-utils';
import { buildHrefResolver } from '../utils/resolve-href';
import { computeChapterRootStyles } from './chapter-root-style';
import {
  buildChapterRules,
  buildStylesheetRuleMap,
  buildStylesheetRules,
} from './pagination-stylesheets';

export interface PreparedPaginationContext {
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly layouter: ParagraphLayouter;
  readonly rules: readonly CssRule[];
  readonly imageSizes: ImageSizeMap | undefined;
  /** Per-stylesheet rules for chapter-scoped filtering. Keys match stylesheet hrefs. */
  readonly rulesByStylesheet: ReadonlyMap<string, readonly CssRule[]>;
  /** Configured initial/root font size used for all stylesheet parsing. */
  readonly rootFontSize: number;
}

export interface PaginatedChapterResult {
  readonly pages: readonly Page[];
  readonly anchorMap: ReadonlyMap<string, number>;
  readonly blockCount: number;
}

export function preparePaginationContext<T extends ImageDimensions>(
  config: LayoutConfig,
  measurer: TextMeasurer,
  stylesheets: ReadonlyMap<string, string>,
  images?: ReadonlyMap<string, T>,
  lineBreaking?: 'greedy' | 'optimal',
): PreparedPaginationContext {
  const rules = buildStylesheetRules(stylesheets, config.rootFontSize);

  return {
    contentWidth: config.pageWidth - config.marginLeft - config.marginRight,
    contentHeight: config.pageHeight - config.marginTop - config.marginBottom,
    layouter: createParagraphLayouter(measurer, lineBreaking),
    rules,
    imageSizes: images ? createImageSizeMap(images) : undefined,
    rulesByStylesheet: buildStylesheetRuleMap(stylesheets, config.rootFontSize),
    rootFontSize: config.rootFontSize,
  };
}

export function paginateChapterNodes(
  nodes: readonly DocumentNode[],
  config: LayoutConfig,
  context: PreparedPaginationContext,
  pageIndexOffset: number,
  bodyAttributes?: ElementAttributes,
  chapterStylesheetHrefs?: readonly string[],
  embeddedStylesheets?: readonly string[],
): PaginatedChapterResult {
  const { chapterBodyStyle, styled } = buildChapterStyleTree(
    nodes,
    config,
    context,
    bodyAttributes,
    chapterStylesheetHrefs,
    embeddedStylesheets,
  );
  const blocks = layoutBlocks(
    styled,
    context.contentWidth,
    context.layouter,
    context.imageSizes,
    context.contentHeight,
  );
  if (blocks.length === 0) {
    return { pages: [], anchorMap: new Map<string, number>(), blockCount: 0 };
  }

  const bodyBg = chapterBodyStyle.backgroundColor || undefined;
  const rawPages = paginateBlocks(blocks, config);
  const pages = bodyBg
    ? indexPages(rawPages, pageIndexOffset).map((p) => ({
        ...p,
        paint: { backgroundColor: bodyBg },
      }))
    : indexPages(rawPages, pageIndexOffset);
  return {
    pages,
    anchorMap: collectAnchorsByPage(pages),
    blockCount: blocks.length,
  };
}

function buildChapterStyleTree(
  nodes: readonly DocumentNode[],
  config: LayoutConfig,
  context: PreparedPaginationContext,
  bodyAttributes: ElementAttributes | undefined,
  chapterStylesheetHrefs: readonly string[] | undefined,
  embeddedStylesheets: readonly string[] | undefined,
): { readonly chapterBodyStyle: ComputedStyle; readonly styled: readonly StyledNode[] } {
  const rules = buildChapterRules(
    context.rules,
    context.rulesByStylesheet,
    chapterStylesheetHrefs,
    embeddedStylesheets,
    context.rootFontSize,
  );

  const viewport: Viewport = { width: config.viewportWidth, height: config.viewportHeight };
  const root = computeChapterRootStyles(rules, config.rootFontSize, bodyAttributes, viewport);
  const chapterBodyStyle = applyTypographyOverrides(root.bodyStyle, config);
  const cascaded = resolveStyles(nodes, chapterBodyStyle, rules, viewport, {
    rootFontSize: root.htmlFontSize,
    ancestors: root.ancestors,
  });
  return { chapterBodyStyle, styled: forceTypographyOnTree(cascaded, config) };
}

function createParagraphLayouter(
  measurer: TextMeasurer,
  lineBreaking: 'greedy' | 'optimal' | undefined,
): ParagraphLayouter {
  return lineBreaking === 'optimal'
    ? createKnuthPlassLayouter(measurer)
    : createGreedyLayouter(measurer);
}

function forceTypographyOnTree(
  nodes: readonly StyledNode[],
  config: LayoutConfig,
): readonly StyledNode[] {
  const forceLh = config.lineHeightForce && config.lineHeightOverride !== undefined;
  const forceFf = config.fontFamilyForce && config.fontFamilyOverride !== undefined;
  if (!forceLh && !forceFf) return nodes;
  const lh = forceLh ? config.lineHeightOverride : undefined;
  const ff = forceFf ? config.fontFamilyOverride : undefined;
  const visit = (node: StyledNode): StyledNode => {
    let style = node.style;
    if (lh !== undefined) {
      style = { ...style, lineHeight: lh };
      // Same reasoning as applyTypographyOverrides: clear lineHeightPx so the
      // unitless multiplier wins (layout reads `lineHeightPx ?? fontSize * lineHeight`).
      (style as unknown as Record<string, unknown>)['lineHeightPx'] = undefined;
    }
    if (ff !== undefined) {
      style = { ...style, fontFamily: ff };
    }
    const children =
      node.children.length === 0
        ? node.children
        : (node.children.map(visit) as readonly StyledNode[]);
    return { ...node, style, children };
  };
  return nodes.map(visit);
}

function applyTypographyOverrides(style: ComputedStyle, config: LayoutConfig): ComputedStyle {
  let result = style;
  if (config.lineHeightOverride !== undefined) {
    result = { ...result, lineHeight: config.lineHeightOverride };
    // The override is a unitless multiplier, so it must shadow any absolute
    // lineHeightPx the EPUB set (layout reads `lineHeightPx ?? fontSize * lineHeight`).
    // Assign undefined (don't delete) so the key is present and overrides the
    // parent value during cascade `{ ...parent, ...patch }` spreads.
    (result as unknown as Record<string, unknown>)['lineHeightPx'] = undefined;
  }
  if (config.fontFamilyOverride !== undefined) {
    result = { ...result, fontFamily: config.fontFamilyOverride };
  }
  return result;
}

function createImageSizeMap<T extends ImageDimensions>(
  images: ReadonlyMap<string, T>,
): ImageSizeMap {
  const resolve = buildHrefResolver(images);
  return {
    getSize(src: string) {
      const size = resolve(src);
      return size ? { width: size.width, height: size.height } : undefined;
    },
  };
}

function indexPages(pages: readonly Page[], pageIndexOffset: number): Page[] {
  return pages.map((page, index) => ({ ...page, index: pageIndexOffset + index }));
}

function collectAnchorsByPage(pages: readonly Page[]): ReadonlyMap<string, number> {
  const anchorMap = new Map<string, number>();
  for (const page of pages) {
    collectAnchors(page.content, page.index, anchorMap);
  }
  return anchorMap;
}

function collectAnchors(
  blocks: readonly LayoutBlock[],
  pageIndex: number,
  anchorMap: Map<string, number>,
): void {
  for (const block of blocks) {
    if (block.anchorId && !anchorMap.has(block.anchorId)) {
      anchorMap.set(block.anchorId, pageIndex);
    }
    for (const child of block.children) {
      if (child.type === 'layout-block') {
        collectAnchors([child], pageIndex, anchorMap);
      }
    }
  }
}
