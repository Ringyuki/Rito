import type { DocumentNode, ElementAttributes } from '../../parser/xhtml/types';
import { DEFAULT_STYLE, inheritableStyle } from '../core/defaults';
import { getTagStyle } from '../core/tag-styles';
import type { ComputedStyle, CssRule, Specificity, StyledNode } from '../core/types';
import { DISPLAY_VALUES } from '../core/types';
import { parseCssDeclarations } from '../css/property-parser';
import { type RuleIndex, buildRuleIndex } from './rule-index';
import type { SelectorTarget } from './selector-matcher';
import { matchesSelector } from './selector-matcher';
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
): readonly StyledNode[] {
  const base = parentStyle ?? DEFAULT_STYLE;
  const index = rules && rules.length > 0 ? buildRuleIndex(rules) : undefined;
  return resolveNodesWithSiblings(nodes, base, rules, index, []);
}

/** Resolve nodes with sibling tracking for +, :first-child, :last-child. */
function resolveNodesWithSiblings(
  nodes: readonly DocumentNode[],
  parentStyle: ComputedStyle,
  rules: readonly CssRule[] | undefined,
  index: RuleIndex | undefined,
  ancestors: readonly SelectorTarget[],
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
      const result = resolveNode(c, parentStyle, rules, index, ancestors, siblingInfo);
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
      return resolveBlockNode(node, parentStyle, rules, index, ancestors, siblingInfo);
    case 'inline':
      return resolveInlineNode(node, parentStyle, rules, index, ancestors, siblingInfo);
    case 'image': {
      const { target: baseTarget, inlineCss } = extractNodeMeta('img', node.attributes);
      const imgTarget = siblingInfo ? mergeSiblingInfo(baseTarget, siblingInfo) : baseTarget;
      const imgStyle = applyCascade(parentStyle, imgTarget, inlineCss, rules, index, ancestors);
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
): StyledNode {
  const { target: baseTarget, inlineCss } = extractNodeMeta(node.tag, node.attributes);
  const target = siblingInfo ? mergeSiblingInfo(baseTarget, siblingInfo) : baseTarget;
  const style = applyCascade(parentStyle, target, inlineCss, rules, index, ancestors);
  if (style.display === DISPLAY_VALUES.None) {
    return { type: 'block', tag: node.tag, style, children: [] };
  }
  const children = resolveChildren(node.children, style, rules, index, [target, ...ancestors]);
  let result: StyledNode = { type: 'block', tag: node.tag, style, children };
  if (node.attributes?.id) result = { ...result, id: node.attributes.id };
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
): StyledNode {
  const { target: baseTarget, inlineCss } = extractNodeMeta(node.tag, node.attributes);
  const target = siblingInfo ? mergeSiblingInfo(baseTarget, siblingInfo) : baseTarget;
  const style = applyCascade(parentStyle, target, inlineCss, rules, index, ancestors);
  if (style.display === DISPLAY_VALUES.None) {
    return { type: 'inline', tag: node.tag, style, children: [] };
  }
  const children = resolveChildren(node.children, style, rules, index, [target, ...ancestors]);
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
): StyledNode[] {
  return resolveNodesWithSiblings(nodes, inheritableStyle(parentStyle), rules, index, ancestors);
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
): ComputedStyle {
  let style = applyTagStyle(parentStyle, target.tag);
  // Pass the true parent fontSize for em resolution in font-size declarations.
  // style.fontSize here may include tag defaults (e.g. h1→32), which must NOT
  // be used as the em basis — CSS em in font-size is always relative to the parent.
  style = applyRules(style, target, parentStyle.fontSize, rules, index, ancestors);
  style = applyInlineStyle(style, inlineCss, parentStyle.fontSize, style.fontSize);
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

function applyRules(
  style: ComputedStyle,
  target: SelectorTarget,
  parentFontSize: number,
  rules: readonly CssRule[] | undefined,
  index: RuleIndex | undefined,
  ancestors: readonly SelectorTarget[],
): ComputedStyle {
  if (!rules || rules.length === 0) return style;

  const candidates = index ? index.getCandidates(target.tag, target.className, target.id) : rules;

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
  if (matches.length === 0) return style;

  matches.sort((a, b) => compareSpecificity(a.specificity, b.specificity));

  // Pass 1: resolve font-size against the true parent fontSize (NOT tag defaults).
  // em in font-size is always relative to the parent element's computed font-size.
  let resolvedFontSize = style.fontSize;
  for (const match of matches) {
    const reparsed = parseCssDeclarations(match.rawDeclarations, parentFontSize);
    if (reparsed.fontSize !== undefined) {
      resolvedFontSize = reparsed.fontSize;
    }
  }

  // Pass 2: re-parse with the element's own font-size for em-dependent properties
  // (margin, padding, etc. use the element's own font-size as em base)
  let result: ComputedStyle = { ...style, fontSize: resolvedFontSize };
  for (const match of matches) {
    const resolved = parseCssDeclarations(match.rawDeclarations, resolvedFontSize);
    result = { ...result, ...resolved, fontSize: resolvedFontSize };
  }
  return result;
}

/**
 * Apply inline style with two-stage em resolution:
 * - font-size in inline style resolves against parent (parentEmBasis)
 * - all other em properties resolve against the element's own computed font-size
 */
function applyInlineStyle(
  style: ComputedStyle,
  inlineCss: string | undefined,
  parentEmBasis: number,
  currentFontSize: number,
): ComputedStyle {
  if (!inlineCss) return style;

  // Pass 1: parse with parent em basis to resolve font-size correctly
  const pass1 = parseCssDeclarations(inlineCss, parentEmBasis);
  const resolvedFontSize = pass1.fontSize ?? currentFontSize;

  // Pass 2: re-parse with the resolved font-size for em-dependent properties
  const pass2 = parseCssDeclarations(inlineCss, resolvedFontSize);
  if (Object.keys(pass2).length === 0) return style;

  // Keep font-size from pass 1 (em in font-size is relative to parent)
  return { ...style, ...pass2, fontSize: resolvedFontSize };
}
