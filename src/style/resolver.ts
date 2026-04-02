import type { DocumentNode } from '../parser/xhtml/types';
import type { ComputedStyle, StyledNode } from './types';
import { DEFAULT_STYLE } from './defaults';
import { parseCssDeclarations } from './css-property-parser';
import { getTagStyle } from './tag-styles';

/**
 * Resolve styles for a document node tree.
 * Walks the tree recursively, applying tag-based style overrides
 * and inheriting from parent styles.
 */
export function resolveStyles(
  nodes: readonly DocumentNode[],
  parentStyle?: ComputedStyle,
): readonly StyledNode[] {
  const base = parentStyle ?? DEFAULT_STYLE;
  return nodes.map((node) => resolveNode(node, base));
}

function resolveNode(node: DocumentNode, parentStyle: ComputedStyle): StyledNode {
  switch (node.type) {
    case 'text':
      return {
        type: 'text',
        content: node.content,
        style: parentStyle,
        children: [],
      };

    case 'block': {
      const style = applyInlineStyle(applyTagStyle(parentStyle, node.tag), node.attributes?.style);
      const children = node.children.map((child) => resolveNode(child, style));
      return { type: 'block', tag: node.tag, style, children };
    }

    case 'inline': {
      const style = applyInlineStyle(applyTagStyle(parentStyle, node.tag), node.attributes?.style);
      const children = node.children.map((child) => resolveNode(child, style));
      return { type: 'inline', tag: node.tag, style, children };
    }
  }
}

function applyTagStyle(parentStyle: ComputedStyle, tag: string): ComputedStyle {
  const overrides = getTagStyle(tag);
  if (!overrides) {
    return parentStyle;
  }
  return { ...parentStyle, ...overrides };
}

function applyInlineStyle(style: ComputedStyle, inlineCss: string | undefined): ComputedStyle {
  if (!inlineCss) return style;
  const overrides = parseCssDeclarations(inlineCss, style.fontSize);
  if (Object.keys(overrides).length === 0) return style;
  return { ...style, ...overrides };
}
