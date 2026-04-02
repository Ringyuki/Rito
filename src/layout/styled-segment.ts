import type { ComputedStyle, StyledNode } from '../style/types';

/** A flat text segment with a single resolved style. */
export interface StyledSegment {
  readonly text: string;
  readonly style: ComputedStyle;
}

/**
 * Flatten a block's StyledNode children into a linear sequence of StyledSegments.
 * Inline nesting is collapsed: <p>Hello <em>world</em></p> becomes
 * [{ text: "Hello ", style: pStyle }, { text: "world", style: emStyle }].
 *
 * Only processes text and inline children. Nested blocks are skipped
 * (they should be handled by block-level layout).
 */
export function flattenInlineContent(children: readonly StyledNode[]): readonly StyledSegment[] {
  const segments: StyledSegment[] = [];
  collectSegments(children, segments);
  return segments;
}

function collectSegments(nodes: readonly StyledNode[], out: StyledSegment[]): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'text': {
        const text = node.content ?? '';
        if (text.length > 0) {
          out.push({ text, style: node.style });
        }
        break;
      }
      case 'inline':
        collectSegments(node.children, out);
        break;
      case 'block':
      case 'image':
        // Nested blocks and images inside inline content are not flattened.
        // They will be handled separately by block layout.
        break;
    }
  }
}
