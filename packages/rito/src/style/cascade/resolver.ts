import type { DocumentNode, ElementAttributes } from '../../parser/xhtml/types';
import { DEFAULT_STYLE, inheritableStyle } from '../core/defaults';
import { getTagStyle } from '../core/tag-styles';
import type { ComputedStyle, CssRule, Specificity, StyledNode } from '../core/types';
import { DISPLAY_VALUES } from '../core/types';
import { parseCssDeclarations } from '../css/property-parser';
import type { Viewport } from '../css/parse-utils';
import { type RuleIndex, buildRuleIndex } from './rule-index';
import type { SelectorTarget } from './selector-matcher';
import { matchesSelector } from './selector-matcher';
import { injectPseudoElements } from './pseudo-elements';
import { calculateSpecificity, compareSpecificity } from './specificity';

/**
 * Resolve styles for a document node tree.
 *
 * Applies the CSS cascade in order:
 * 1. Inherited parent style (or DEFAULT_STYLE)
 * 2. Tag-based defaults
 * 3. Stylesheet rules (sorted by specificity)
 * 4. Inline `style` attribute (highest priority)
 */
export function resolveStyles(
  nodes: readonly DocumentNode[],
  parentStyle?: ComputedStyle,
  rules?: readonly CssRule[],
  viewport?: Viewport,
): readonly StyledNode[] {
  // Apply inheritableStyle to strip non-inherited properties (margin, padding, etc.)
  // from the body/parent style. Only inherited properties (font, color, text-align)
  // should cascade to top-level elements.
  const base = parentStyle ? inheritableStyle(parentStyle) : DEFAULT_STYLE;
  const index = rules && rules.length > 0 ? buildRuleIndex(rules) : undefined;
  return resolveNodesWithSiblings(nodes, base, rules, index, [], viewport);
}

/** Resolve nodes with sibling tracking for +, :first-child, :last-child. */
function resolveNodesWithSiblings(
  nodes: readonly DocumentNode[],
  parentStyle: ComputedStyle,
  rules: readonly CssRule[] | undefined,
  index: RuleIndex | undefined,
  ancestors: readonly SelectorTarget[],
  viewport?: Viewport,
): StyledNode[] {
  const elementNodes = nodes.filter(isElementNode);
  const siblingCount = elementNodes.length;
  let elementIndex = 0;
  let prevTarget: SelectorTarget | undefined;

  return nodes
    .map((c) => {
      const isElem = isElementNode(c);
      const siblingInfo: SiblingInfo | undefined = isElem
        ? {
            siblingIndex: elementIndex,
            siblingCount,
            ...(prevTarget ? { previousSibling: prevTarget } : {}),
          }
        : undefined;
      const result = resolveNode(c, parentStyle, rules, index, ancestors, siblingInfo, viewport);
      if (isElem && siblingInfo) {
        const tag = c.type === 'image' ? 'img' : (c as DocumentNode & { tag: string }).tag;
        const attrs = (c as DocumentNode & { attributes?: ElementAttributes }).attributes;
        const { target } = extractNodeMeta(tag, attrs);
        prevTarget = mergeSiblingInfo(target, siblingInfo);
        elementIndex++;
      }
      return result;
    })
    .filter((n) => n.style.display !== DISPLAY_VALUES.None);
}

function isElementNode(node: DocumentNode): boolean {
  return node.type === 'block' || node.type === 'inline' || node.type === 'image';
}

function resolveNode(
  node: DocumentNode,
  parentStyle: ComputedStyle,
  rules: readonly CssRule[] | undefined,
  index: RuleIndex | undefined,
  ancestors: readonly SelectorTarget[],
  siblingInfo?: SiblingInfo,
  viewport?: Viewport,
): StyledNode {
  switch (node.type) {
    case 'text':
      return {
        type: 'text',
        content: node.content,
        style: parentStyle,
        children: [],
        ...(node.sourceRef ? { sourceRef: node.sourceRef } : {}),
      };
    case 'block':
      return resolveBlockNode(node, parentStyle, rules, index, ancestors, siblingInfo, viewport);
    case 'inline':
      return resolveInlineNode(node, parentStyle, rules, index, ancestors, siblingInfo, viewport);
    case 'image': {
      const { target: baseTarget, inlineCss } = extractNodeMeta('img', node.attributes);
      const imgTarget = siblingInfo ? mergeSiblingInfo(baseTarget, siblingInfo) : baseTarget;
      const imgStyle = applyCascade(
        parentStyle,
        imgTarget,
        inlineCss,
        rules,
        index,
        ancestors,
        viewport,
      );
      return {
        type: 'image',
        src: node.src,
        alt: node.alt,
        style: imgStyle,
        children: [],
        ...(node.sourceRef ? { sourceRef: node.sourceRef } : {}),
      };
    }
  }
}

function resolveBlockNode(
  node: DocumentNode & { type: 'block' },
  parentStyle: ComputedStyle,
  rules: readonly CssRule[] | undefined,
  index: RuleIndex | undefined,
  ancestors: readonly SelectorTarget[],
  siblingInfo?: SiblingInfo,
  viewport?: Viewport,
): StyledNode {
  const { target: baseTarget, inlineCss } = extractNodeMeta(node.tag, node.attributes);
  const target = siblingInfo ? mergeSiblingInfo(baseTarget, siblingInfo) : baseTarget;
  const style = applyCascade(parentStyle, target, inlineCss, rules, index, ancestors, viewport);
  if (style.display === DISPLAY_VALUES.None) {
    return { type: 'block', tag: node.tag, style, children: [] };
  }
  const resolved = resolveChildren(
    node.children,
    style,
    rules,
    index,
    [target, ...ancestors],
    viewport,
  );
  const children = injectPseudoElements(resolved, style, target, rules, index, ancestors);
  let result: StyledNode = { type: 'block', tag: node.tag, style, children };
  if (node.attributes?.id) result = { ...result, id: node.attributes.id };
  if (node.attributes?.href) result = { ...result, href: node.attributes.href };
  if (node.attributes?.colspan) result = { ...result, colspan: node.attributes.colspan };
  if (node.attributes?.rowspan) result = { ...result, rowspan: node.attributes.rowspan };
  if (node.sourceRef) result = { ...result, sourceRef: node.sourceRef };
  return result;
}

function resolveInlineNode(
  node: DocumentNode & { type: 'inline' },
  parentStyle: ComputedStyle,
  rules: readonly CssRule[] | undefined,
  index: RuleIndex | undefined,
  ancestors: readonly SelectorTarget[],
  siblingInfo?: SiblingInfo,
  viewport?: Viewport,
): StyledNode {
  const { target: baseTarget, inlineCss } = extractNodeMeta(node.tag, node.attributes);
  const target = siblingInfo ? mergeSiblingInfo(baseTarget, siblingInfo) : baseTarget;
  const style = applyCascade(parentStyle, target, inlineCss, rules, index, ancestors, viewport);
  if (style.display === DISPLAY_VALUES.None) {
    return { type: 'inline', tag: node.tag, style, children: [] };
  }
  const resolved = resolveChildren(
    node.children,
    style,
    rules,
    index,
    [target, ...ancestors],
    viewport,
  );
  const children = injectPseudoElements(resolved, style, target, rules, index, ancestors, true);
  let result: StyledNode = { type: 'inline', tag: node.tag, style, children };
  if (node.attributes?.id) result = { ...result, id: node.attributes.id };
  if (node.attributes?.href) result = { ...result, href: node.attributes.href };
  if (node.sourceRef) result = { ...result, sourceRef: node.sourceRef };
  return result;
}

function resolveChildren(
  nodes: readonly DocumentNode[],
  parentStyle: ComputedStyle,
  rules: readonly CssRule[] | undefined,
  index: RuleIndex | undefined,
  ancestors: readonly SelectorTarget[],
  viewport?: Viewport,
): StyledNode[] {
  return resolveNodesWithSiblings(
    nodes,
    inheritableStyle(parentStyle),
    rules,
    index,
    ancestors,
    viewport,
  );
}

interface SiblingInfo {
  siblingIndex: number;
  siblingCount: number;
  previousSibling?: SelectorTarget;
}

function mergeSiblingInfo(target: SelectorTarget, info: SiblingInfo): SelectorTarget {
  const result: SelectorTarget = {
    ...target,
    siblingIndex: info.siblingIndex,
    siblingCount: info.siblingCount,
  };
  if (info.previousSibling) {
    return { ...result, previousSibling: info.previousSibling };
  }
  return result;
}

function extractNodeMeta(
  tag: string,
  attributes: ElementAttributes | undefined,
): { target: SelectorTarget; inlineCss: string | undefined } {
  const target: SelectorTarget & {
    className?: string;
    id?: string;
    attributes?: ReadonlyMap<string, string>;
  } = { tag };
  if (attributes?.class) target.className = attributes.class;
  if (attributes?.id) target.id = attributes.id;
  if (attributes?.allAttributes) target.attributes = attributes.allAttributes;
  return { target, inlineCss: attributes?.style };
}

function applyCascade(
  parentStyle: ComputedStyle,
  target: SelectorTarget,
  inlineCss: string | undefined,
  rules: readonly CssRule[] | undefined,
  index: RuleIndex | undefined,
  ancestors: readonly SelectorTarget[],
  viewport?: Viewport,
): ComputedStyle {
  let style = applyTagStyle(parentStyle, target.tag);
  style = applyUnifiedRules(
    style,
    target,
    parentStyle.fontSize,
    rules,
    index,
    ancestors,
    inlineCss,
    viewport,
  );
  return style;
}

function applyTagStyle(parentStyle: ComputedStyle, tag: string): ComputedStyle {
  const overrides = getTagStyle(tag);
  if (!overrides) return parentStyle;
  return { ...parentStyle, ...overrides };
}

interface MatchedRule {
  readonly rawDeclarations: string;
  readonly declarations: Partial<ComputedStyle>;
  readonly specificity: Specificity;
}

/** Inline style specificity — higher than any selector. */
const INLINE_SPECIFICITY: Specificity = [Infinity, 0, 0];

/**
 * Unified cascade: stylesheet rules + inline style resolved together.
 *
 * CSS em values in `font-size` resolve against the **parent** font-size,
 * while em values in other properties resolve against the element's own
 * computed font-size. A two-pass approach handles this:
 *
 * - Pass 1: determine the final font-size from ALL sources (rules + inline)
 * - Pass 2: re-parse ALL declarations with that final font-size
 *
 * When rules and inline were processed separately, an inline `font-size`
 * could not retroactively fix em-dependent stylesheet properties
 * (e.g. `.lh { line-height: 1em }` resolved against the wrong font-size).
 */
function applyUnifiedRules(
  style: ComputedStyle,
  target: SelectorTarget,
  parentFontSize: number,
  rules: readonly CssRule[] | undefined,
  index: RuleIndex | undefined,
  ancestors: readonly SelectorTarget[],
  inlineCss: string | undefined,
  viewport?: Viewport,
): ComputedStyle {
  const candidates =
    rules && rules.length > 0
      ? index
        ? index.getCandidates(target.tag, target.className, target.id)
        : rules
      : [];

  const matches: MatchedRule[] = [];
  for (const rule of candidates) {
    if (matchesSelector(target, rule.selector, ancestors)) {
      matches.push({
        rawDeclarations: rule.rawDeclarations,
        declarations: rule.declarations,
        specificity: calculateSpecificity(rule.selector),
      });
    }
  }

  // Add inline style as the highest-priority entry
  if (inlineCss) {
    matches.push({
      rawDeclarations: inlineCss,
      declarations: parseCssDeclarations(inlineCss, parentFontSize, parentFontSize, viewport),
      specificity: INLINE_SPECIFICITY,
    });
  }

  if (matches.length === 0) return style;
  matches.sort((a, b) => compareSpecificity(a.specificity, b.specificity));

  // Pass 1: resolve font-size from ALL sources against the parent fontSize.
  let resolvedFontSize = style.fontSize;
  for (const match of matches) {
    const reparsed = parseCssDeclarations(
      match.rawDeclarations,
      parentFontSize,
      parentFontSize,
      viewport,
    );
    if (reparsed.fontSize !== undefined) {
      resolvedFontSize = reparsed.fontSize;
    }
  }

  // Pass 2: re-parse ALL declarations with the element's final font-size.
  let result: ComputedStyle = { ...style, fontSize: resolvedFontSize };
  for (const match of matches) {
    const resolved = parseCssDeclarations(
      match.rawDeclarations,
      resolvedFontSize,
      resolvedFontSize,
      viewport,
    );
    result = { ...result, ...resolved, fontSize: resolvedFontSize };
  }
  return result;
}
