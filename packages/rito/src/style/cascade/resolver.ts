import type { BlockNode, DocumentNode, InlineNode } from '../../parser/xhtml/types';
import { DEFAULT_STYLE, inheritableStyle } from '../core/defaults';
import type { ComputedStyle, CssRule, StyledNode } from '../core/types';
import { DISPLAY_VALUES } from '../core/types';
import type { Viewport } from '../css/parse-utils';
import { withDefaultUaRules } from '../ua/default-rules';
import {
  buildSelectorTarget,
  resolveElement,
  resolveImageNode,
  resolveTextNode,
  type SiblingInfo,
  type TreeResolutionContext,
} from './node-resolution';
import { injectPseudoElements } from './pseudo-elements';
import { buildRuleIndex } from './rule-index';
import type { SelectorTarget } from './selector-matcher';

/**
 * Resolve styles for a document node tree.
 *
 * Applies the CSS cascade in order:
 * 1. Inherited parent style (or DEFAULT_STYLE)
 * 2. Runtime replaced-element defaults
 * 3. User-agent rules
 * 4. Author stylesheet rules
 * 5. Inline `style` attribute (highest priority)
 */
export function resolveStyles(
  nodes: readonly DocumentNode[],
  parentStyle?: ComputedStyle,
  rules?: readonly CssRule[],
  viewport?: Viewport,
  context?: StyleResolutionContext,
): readonly StyledNode[] {
  const base = parentStyle ? inheritableStyle(parentStyle) : DEFAULT_STYLE;
  const cascadeRules = withDefaultUaRules(rules);
  const rootFontSize = context?.rootFontSize ?? parentStyle?.fontSize ?? DEFAULT_STYLE.fontSize;
  return resolveNodesWithSiblings(nodes, {
    parentStyle: base,
    rules: cascadeRules,
    index: buildRuleIndex(cascadeRules),
    ancestors: context?.ancestors ?? [],
    rootFontSize,
    viewport,
  });
}

/** Extra cascade context for parsed fragments whose html/body wrappers are external. */
export interface StyleResolutionContext {
  /** Computed font size of the document root, used exclusively as the `rem` basis. */
  readonly rootFontSize?: number;
  /** Existing selector ancestors, ordered from immediate parent to root. */
  readonly ancestors?: readonly SelectorTarget[];
}

type ElementNode = BlockNode | InlineNode | Extract<DocumentNode, { type: 'image' }>;

/** Resolve nodes while tracking element-only sibling positions for selectors. */
function resolveNodesWithSiblings(
  nodes: readonly DocumentNode[],
  context: TreeResolutionContext,
): StyledNode[] {
  const siblingCount = nodes.filter(isElementNode).length;
  const result: StyledNode[] = [];
  let elementIndex = 0;
  let previousSibling: SelectorTarget | undefined;

  for (const node of nodes) {
    const siblingInfo = isElementNode(node)
      ? createSiblingInfo(elementIndex, siblingCount, previousSibling)
      : undefined;
    const styled = resolveNode(node, context, siblingInfo);
    if (styled.style.display !== DISPLAY_VALUES.None) result.push(styled);
    if (!siblingInfo || !isElementNode(node)) continue;
    previousSibling = buildElementTarget(node, siblingInfo);
    elementIndex++;
  }
  return result;
}

function createSiblingInfo(
  siblingIndex: number,
  siblingCount: number,
  previousSibling: SelectorTarget | undefined,
): SiblingInfo {
  return {
    siblingIndex,
    siblingCount,
    ...(previousSibling ? { previousSibling } : {}),
  };
}

function isElementNode(node: DocumentNode): node is ElementNode {
  return node.type === 'block' || node.type === 'inline' || node.type === 'image';
}

function buildElementTarget(node: ElementNode, siblingInfo: SiblingInfo): SelectorTarget {
  const tag = node.type === 'image' ? 'img' : node.tag;
  return buildSelectorTarget(tag, node.attributes, siblingInfo);
}

function resolveNode(
  node: DocumentNode,
  context: TreeResolutionContext,
  siblingInfo?: SiblingInfo,
): StyledNode {
  switch (node.type) {
    case 'text':
      return resolveTextNode(node, context.parentStyle);
    case 'block':
      return resolveBlockNode(node, context, siblingInfo);
    case 'inline':
      return resolveInlineNode(node, context, siblingInfo);
    case 'image':
      return resolveImageNode(node, context, siblingInfo);
  }
}

function resolveBlockNode(
  node: BlockNode,
  context: TreeResolutionContext,
  siblingInfo?: SiblingInfo,
): StyledNode {
  const { target, style } = resolveElement(node.tag, node.attributes, context, siblingInfo);
  if (style.display === DISPLAY_VALUES.None) {
    return { type: 'block', tag: node.tag, style, children: [] };
  }
  const rootFontSize = node.tag === 'html' ? style.fontSize : context.rootFontSize;
  const resolved = resolveNodesWithSiblings(
    node.children,
    createChildContext(context, style, target, rootFontSize),
  );
  const children = injectPseudoElements(
    resolved,
    style,
    target,
    context.rules,
    context.index,
    context.ancestors,
    rootFontSize,
  );
  return attachBlockMetadata({ type: 'block', tag: node.tag, style, children }, node);
}

function resolveInlineNode(
  node: InlineNode,
  context: TreeResolutionContext,
  siblingInfo?: SiblingInfo,
): StyledNode {
  const { target, style } = resolveElement(node.tag, node.attributes, context, siblingInfo);
  if (style.display === DISPLAY_VALUES.None) {
    return { type: 'inline', tag: node.tag, style, children: [] };
  }
  const resolved = resolveNodesWithSiblings(
    node.children,
    createChildContext(context, style, target, context.rootFontSize),
  );
  const children = injectPseudoElements(
    resolved,
    style,
    target,
    context.rules,
    context.index,
    context.ancestors,
    context.rootFontSize,
    true,
  );
  return attachInlineMetadata({ type: 'inline', tag: node.tag, style, children }, node);
}

function createChildContext(
  context: TreeResolutionContext,
  parentStyle: ComputedStyle,
  parentTarget: SelectorTarget,
  rootFontSize: number,
): TreeResolutionContext {
  return {
    ...context,
    parentStyle: inheritableStyle(parentStyle),
    ancestors: [parentTarget, ...context.ancestors],
    rootFontSize,
  };
}

function attachBlockMetadata(result: StyledNode, node: BlockNode): StyledNode {
  return {
    ...result,
    ...(node.attributes?.id ? { id: node.attributes.id } : {}),
    ...(node.attributes?.href ? { href: node.attributes.href } : {}),
    ...(node.attributes?.colspan ? { colspan: node.attributes.colspan } : {}),
    ...(node.attributes?.rowspan ? { rowspan: node.attributes.rowspan } : {}),
    ...(node.sourceRef ? { sourceRef: node.sourceRef } : {}),
  };
}

function attachInlineMetadata(result: StyledNode, node: InlineNode): StyledNode {
  return {
    ...result,
    ...(node.attributes?.id ? { id: node.attributes.id } : {}),
    ...(node.attributes?.href ? { href: node.attributes.href } : {}),
    ...(node.sourceRef ? { sourceRef: node.sourceRef } : {}),
  };
}
