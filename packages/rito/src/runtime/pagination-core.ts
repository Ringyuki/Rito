import type { ImageSizeMap } from '../layout/block';
import { layoutBlocks } from '../layout/block';
import { createGreedyLayouter, createKnuthPlassLayouter } from '../layout/line-breaker';
import { paginateBlocks } from '../layout/pagination';
import type { LayoutBlock, LayoutConfig, Page } from '../layout/core/types';
import type { ParagraphLayouter } from '../layout/text/paragraph-layouter';
import type { TextMeasurer } from '../layout/text/text-measurer';
import type { DocumentNode } from '../parser/xhtml/types';
import { matchesSelector } from '../style/cascade/selector-matcher';
import { resolveStyles } from '../style/cascade/resolver';
import { DEFAULT_STYLE } from '../style/core/defaults';
import type { ComputedStyle, CssRule } from '../style/core/types';
import { parseCssDeclarations } from '../style/css/property-parser';
import type { Viewport } from '../style/css/parse-utils';
import { parseCssRules } from '../style/css/rule-parser';
import { buildHrefResolver } from '../utils/resolve-href';

type SizeLike = { readonly width: number; readonly height: number };

export interface PreparedPaginationContext {
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly layouter: ParagraphLayouter;
  readonly rules: readonly CssRule[];
  readonly bodyStyle: ComputedStyle;
  readonly imageSizes: ImageSizeMap | undefined;
  /** Per-stylesheet rules for chapter-scoped filtering. Keys match stylesheet hrefs. */
  readonly rulesByStylesheet: ReadonlyMap<string, readonly CssRule[]>;
}

export interface PaginatedChapterResult {
  readonly pages: readonly Page[];
  readonly anchorMap: ReadonlyMap<string, number>;
  readonly blockCount: number;
}

export function preparePaginationContext<T extends SizeLike>(
  config: LayoutConfig,
  measurer: TextMeasurer,
  stylesheets: ReadonlyMap<string, string>,
  images?: ReadonlyMap<string, T>,
  lineBreaking?: 'greedy' | 'optimal',
): PreparedPaginationContext {
  const viewport: Viewport = { width: config.viewportWidth, height: config.viewportHeight };
  const rules = buildRules(stylesheets);
  let bodyStyle = computeBodyStyle(rules, viewport);

  // Apply global typography overrides onto bodyStyle so they cascade via CSS inheritance
  if (config.lineHeightOverride !== undefined) {
    bodyStyle = { ...bodyStyle, lineHeight: config.lineHeightOverride };
  }
  if (config.fontFamilyOverride !== undefined) {
    bodyStyle = { ...bodyStyle, fontFamily: config.fontFamilyOverride };
  }

  return {
    contentWidth: config.pageWidth - config.marginLeft - config.marginRight,
    contentHeight: config.pageHeight - config.marginTop - config.marginBottom,
    layouter: createParagraphLayouter(measurer, lineBreaking),
    rules,
    bodyStyle,
    imageSizes: images ? createImageSizeMap(images) : undefined,
    rulesByStylesheet: buildRulesPerStylesheet(stylesheets),
  };
}

export function paginateChapterNodes(
  nodes: readonly DocumentNode[],
  config: LayoutConfig,
  context: PreparedPaginationContext,
  pageIndexOffset: number,
  bodyAttributes?: { readonly class?: string; readonly style?: string },
  chapterStylesheetHrefs?: readonly string[],
): PaginatedChapterResult {
  // When a chapter declares specific <link> stylesheets, scope rules to only
  // those CSS files. This prevents unrelated stylesheets (intended for other
  // chapters) from leaking conflicting rules (e.g. div { text-align: center }
  // from a prose stylesheet overriding div { text-align: justify } in a title page).
  const rules = chapterStylesheetHrefs
    ? filterRulesByChapterHrefs(context, chapterStylesheetHrefs)
    : context.rules;

  const viewport: Viewport = { width: config.viewportWidth, height: config.viewportHeight };
  const bodyStyle = computeBodyStyle(rules, viewport);
  const chapterBodyStyle = bodyAttributes
    ? resolveBodyStyleWithAttrs(bodyStyle, rules, bodyAttributes, viewport)
    : bodyStyle;
  const styled = resolveStyles(nodes, chapterBodyStyle, rules, viewport);
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

function createParagraphLayouter(
  measurer: TextMeasurer,
  lineBreaking: 'greedy' | 'optimal' | undefined,
): ParagraphLayouter {
  return lineBreaking === 'optimal'
    ? createKnuthPlassLayouter(measurer)
    : createGreedyLayouter(measurer);
}

function buildRules(stylesheets: ReadonlyMap<string, string>): CssRule[] {
  const rules: CssRule[] = [];
  for (const css of stylesheets.values()) {
    rules.push(...parseCssRules(css, DEFAULT_STYLE.fontSize));
  }
  return rules;
}

function buildRulesPerStylesheet(
  stylesheets: ReadonlyMap<string, string>,
): ReadonlyMap<string, readonly CssRule[]> {
  const map = new Map<string, readonly CssRule[]>();
  for (const [href, css] of stylesheets) {
    map.set(href, parseCssRules(css, DEFAULT_STYLE.fontSize));
  }
  return map;
}

/**
 * Build a chapter-scoped rule set by matching `<link>` hrefs from the chapter
 * against the per-stylesheet rule map. Uses suffix matching to resolve relative
 * paths (e.g. `../Styles/Style_0002.css` matches manifest href `Styles/Style_0002.css`).
 */
function filterRulesByChapterHrefs(
  context: PreparedPaginationContext,
  linkHrefs: readonly string[],
): readonly CssRule[] {
  const rules: CssRule[] = [];
  const stylesheetKeys = [...context.rulesByStylesheet.keys()];
  for (const linkHref of linkHrefs) {
    const normalized = stripRelativePrefix(linkHref);
    const matchingKey = stylesheetKeys.find(
      (key) =>
        key === normalized || key.endsWith('/' + normalized) || normalized.endsWith('/' + key),
    );
    if (matchingKey) {
      rules.push(...(context.rulesByStylesheet.get(matchingKey) ?? []));
    }
  }
  return rules;
}

function stripRelativePrefix(href: string): string {
  return href.replace(/^(?:\.\.\/)+/, '');
}

function resolveBodyStyleWithAttrs(
  baseBodyStyle: ComputedStyle,
  rules: readonly CssRule[],
  attrs: { readonly class?: string; readonly style?: string },
  viewport?: Viewport,
): ComputedStyle {
  let style = baseBodyStyle;
  const target = attrs.class ? { tag: 'body', className: attrs.class } : { tag: 'body' };
  for (const rule of rules) {
    if (matchesSelector(target, rule.selector)) {
      const resolved = parseCssDeclarations(
        rule.rawDeclarations,
        style.fontSize,
        style.fontSize,
        viewport,
      );
      style = { ...style, ...resolved };
    }
  }
  if (attrs.style) {
    const inline = parseCssDeclarations(attrs.style, style.fontSize, style.fontSize, viewport);
    style = { ...style, ...inline };
  }
  return style;
}

function computeBodyStyle(rules: readonly CssRule[], viewport?: Viewport): ComputedStyle {
  let style: ComputedStyle = DEFAULT_STYLE;
  for (const rule of rules) {
    if (rule.selector === 'body' || rule.selector === 'html') {
      const resolved = parseCssDeclarations(
        rule.rawDeclarations,
        style.fontSize,
        style.fontSize,
        viewport,
      );
      style = { ...style, ...resolved };
    }
  }
  return style;
}

function createImageSizeMap<T extends SizeLike>(images: ReadonlyMap<string, T>): ImageSizeMap {
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
