import type { DocumentNode, ElementAttributes } from '../parser/xhtml/types';
import type { ComputedStyle, CssRule, Specificity, StyledNode } from './types';
import { DISPLAY_VALUES } from './types';
import { DEFAULT_STYLE, inheritableStyle } from './defaults';
import { parseCssDeclarations } from './css-property-parser';
import type { SelectorTarget } from './selector-matcher';
import { matchesSelector } from './selector-matcher';
import { calculateSpecificity, compareSpecificity } from './specificity';
import { getTagStyle } from './tag-styles';

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
  return nodes
    .map((node) => resolveNode(node, base, rules, []))
    .filter((node) => node.style.display !== DISPLAY_VALUES.None);
}

function resolveNode(
  node: DocumentNode,
  parentStyle: ComputedStyle,
  rules: readonly CssRule[] | undefined,
  ancestors: readonly SelectorTarget[],
): StyledNode {
  switch (node.type) {
    case 'text':
      return { type: 'text', content: node.content, style: parentStyle, children: [] };
    case 'block':
      return resolveBlockNode(node, parentStyle, rules, ancestors);
    case 'inline':
      return resolveInlineNode(node, parentStyle, rules, ancestors);
    case 'image':
      return { type: 'image', src: node.src, style: parentStyle, children: [] };
  }
}

function resolveBlockNode(
  node: DocumentNode & { type: 'block' },
  parentStyle: ComputedStyle,
  rules: readonly CssRule[] | undefined,
  ancestors: readonly SelectorTarget[],
): StyledNode {
  const { target, inlineCss } = extractNodeMeta(node.tag, node.attributes);
  const style = applyCascade(parentStyle, target, inlineCss, rules, ancestors);
  if (style.display === DISPLAY_VALUES.None) {
    return { type: 'block', tag: node.tag, style, children: [] };
  }
  const children = resolveChildren(node.children, style, rules, [target, ...ancestors]);
  let result: StyledNode = { type: 'block', tag: node.tag, style, children };
  if (node.attributes?.id) result = { ...result, id: node.attributes.id };
  if (node.attributes?.colspan) result = { ...result, colspan: node.attributes.colspan };
  if (node.attributes?.rowspan) result = { ...result, rowspan: node.attributes.rowspan };
  return result;
}

function resolveInlineNode(
  node: DocumentNode & { type: 'inline' },
  parentStyle: ComputedStyle,
  rules: readonly CssRule[] | undefined,
  ancestors: readonly SelectorTarget[],
): StyledNode {
  const { target, inlineCss } = extractNodeMeta(node.tag, node.attributes);
  const style = applyCascade(parentStyle, target, inlineCss, rules, ancestors);
  if (style.display === DISPLAY_VALUES.None) {
    return { type: 'inline', tag: node.tag, style, children: [] };
  }
  const children = resolveChildren(node.children, style, rules, [target, ...ancestors]);
  const result: StyledNode = { type: 'inline', tag: node.tag, style, children };
  return node.attributes?.id ? { ...result, id: node.attributes.id } : result;
}

function resolveChildren(
  nodes: readonly DocumentNode[],
  parentStyle: ComputedStyle,
  rules: readonly CssRule[] | undefined,
  ancestors: readonly SelectorTarget[],
): StyledNode[] {
  const childStyle = inheritableStyle(parentStyle);
  return nodes
    .map((c) => resolveNode(c, childStyle, rules, ancestors))
    .filter((c) => c.style.display !== DISPLAY_VALUES.None);
}

function extractNodeMeta(
  tag: string,
  attributes: ElementAttributes | undefined,
): { target: SelectorTarget; inlineCss: string | undefined } {
  const target: { tag: string; className?: string; id?: string } = { tag };
  if (attributes?.class) target.className = attributes.class;
  if (attributes?.id) target.id = attributes.id;
  return { target, inlineCss: attributes?.style };
}

function applyCascade(
  parentStyle: ComputedStyle,
  target: SelectorTarget,
  inlineCss: string | undefined,
  rules: readonly CssRule[] | undefined,
  ancestors: readonly SelectorTarget[],
): ComputedStyle {
  let style = applyTagStyle(parentStyle, target.tag);
  style = applyRules(style, target, rules, ancestors);
  // Inline em values resolve against the inherited (parent) font-size,
  // not the element's computed font-size from class/rule overrides.
  // This matches browser CSS behavior.
  style = applyInlineStyle(style, inlineCss, parentStyle.fontSize);
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
  rules: readonly CssRule[] | undefined,
  ancestors: readonly SelectorTarget[],
): ComputedStyle {
  if (!rules || rules.length === 0) return style;

  const matches: MatchedRule[] = [];
  for (const rule of rules) {
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

  // Pass 1: apply font-size from pre-parsed declarations (resolved against parent em)
  let resolvedFontSize = style.fontSize;
  for (const match of matches) {
    if (match.declarations.fontSize !== undefined) {
      resolvedFontSize = match.declarations.fontSize;
    }
  }

  // Pass 2: re-parse with the resolved font-size for em-dependent properties
  // (font-size itself is kept from pass 1 since em in font-size is relative to parent)
  let result: ComputedStyle = { ...style, fontSize: resolvedFontSize };
  for (const match of matches) {
    const resolved = parseCssDeclarations(match.rawDeclarations, resolvedFontSize);
    result = { ...result, ...resolved, fontSize: resolvedFontSize };
  }
  return result;
}

function applyInlineStyle(
  style: ComputedStyle,
  inlineCss: string | undefined,
  emBasis: number,
): ComputedStyle {
  if (!inlineCss) return style;
  const overrides = parseCssDeclarations(inlineCss, emBasis);
  if (Object.keys(overrides).length === 0) return style;
  return { ...style, ...overrides };
}
