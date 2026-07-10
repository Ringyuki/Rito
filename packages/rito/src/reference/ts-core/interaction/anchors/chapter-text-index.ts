/**
 * Chapter-level text index for annotation anchoring.
 * Builds a normalized text string from the parsed XHTML tree with
 * bidirectional mapping between source positions and text offsets.
 */

import type { DocumentNode } from '../../parser/xhtml/types';

/** A mapping span between source tree position and normalized text offset. */
export interface ChapterTextSpan {
  readonly nodePath: readonly number[];
  /** Character range in the source text node. */
  readonly sourceStart: number;
  readonly sourceEnd: number;
  /** Corresponding range in normalizedText. */
  readonly normalizedStart: number;
  readonly normalizedEnd: number;
}

/** Indexed chapter text for selector creation and resolution. */
export interface ChapterTextIndex {
  readonly href: string;
  readonly normalizedText: string;
  readonly spans: readonly ChapterTextSpan[];
}

/**
 * Build a chapter text index from parsed DocumentNodes.
 * Applies the same whitespace collapsing as the XHTML parser so the
 * normalized text matches what eventually reaches the layout pipeline.
 */
export function buildChapterTextIndex(
  href: string,
  nodes: readonly DocumentNode[],
): ChapterTextIndex {
  const spans: ChapterTextSpan[] = [];
  const parts: string[] = [];
  let offset = 0;

  function walk(node: DocumentNode): void {
    switch (node.type) {
      case 'text': {
        const text = node.content;
        if (text.length === 0) return;
        const nodePath = node.sourceRef?.nodePath ?? [];
        spans.push({
          nodePath,
          sourceStart: 0,
          sourceEnd: text.length,
          normalizedStart: offset,
          normalizedEnd: offset + text.length,
        });
        parts.push(text);
        offset += text.length;
        break;
      }
      case 'block':
      case 'inline':
        for (const child of node.children) walk(child);
        break;
      case 'image':
        // Images don't contribute text
        break;
    }
  }

  for (const node of nodes) walk(node);
  return { href, normalizedText: parts.join(''), spans };
}
