import { describe, expect, it } from 'vitest';
import { flattenInlineContent } from '../../src/layout/styled-segment';
import { resolveStyles } from '../../src/style/resolver';
import { DEFAULT_STYLE } from '../../src/style/defaults';
import type { StyledNode } from '../../src/style/types';
import type { DocumentNode } from '../../src/parser/xhtml/types';
import { NODE_TYPES } from '../../src/parser/xhtml/types';

function text(content: string): DocumentNode {
  return { type: NODE_TYPES.Text, content };
}

function inline(tag: string, children: DocumentNode[]): DocumentNode {
  return { type: NODE_TYPES.Inline, tag, children };
}

function block(tag: string, children: DocumentNode[]): DocumentNode {
  return { type: NODE_TYPES.Block, tag, children };
}

/** Resolve a single block and return its styled node. */
function resolveBlock(node: DocumentNode, parentStyle = DEFAULT_STYLE): StyledNode {
  const result = resolveStyles([node], parentStyle);
  const first = result[0];
  if (!first) throw new Error('Expected at least one styled node');
  return first;
}

describe('flattenInlineContent', () => {
  it('flattens a single text node', () => {
    const p = resolveBlock(block('p', [text('hello')]));
    const segments = flattenInlineContent(p.children);

    expect(segments).toHaveLength(1);
    expect(segments[0]?.text).toBe('hello');
    // Text nodes inherit from parent but non-inheritable props (margins, etc.) are reset
    expect(segments[0]?.style.fontFamily).toBe(p.style.fontFamily);
    expect(segments[0]?.style.fontSize).toBe(p.style.fontSize);
    expect(segments[0]?.style.color).toBe(p.style.color);
  });

  it('flattens text with inline markup', () => {
    const p = resolveBlock(block('p', [text('Hello '), inline('em', [text('world')])]));
    const segments = flattenInlineContent(p.children);

    expect(segments).toHaveLength(2);
    expect(segments[0]?.text).toBe('Hello ');
    expect(segments[0]?.style.fontStyle).toBe('normal');
    expect(segments[1]?.text).toBe('world');
    expect(segments[1]?.style.fontStyle).toBe('italic');
  });

  it('flattens deeply nested inlines', () => {
    const p = resolveBlock(block('p', [inline('strong', [inline('em', [text('bold italic')])])]));
    const segments = flattenInlineContent(p.children);

    expect(segments).toHaveLength(1);
    expect(segments[0]?.text).toBe('bold italic');
    expect(segments[0]?.style.fontWeight).toBe('bold');
    expect(segments[0]?.style.fontStyle).toBe('italic');
  });

  it('skips nested blocks', () => {
    const div = resolveBlock(
      block('div', [text('before'), block('p', [text('inside')]), text('after')]),
    );
    const segments = flattenInlineContent(div.children);

    expect(segments).toHaveLength(2);
    expect(segments[0]?.text).toBe('before');
    expect(segments[1]?.text).toBe('after');
  });

  it('skips empty text nodes', () => {
    const p = resolveBlock(block('p', [text(''), text('content')]));
    const segments = flattenInlineContent(p.children);

    expect(segments).toHaveLength(1);
    expect(segments[0]?.text).toBe('content');
  });

  it('preserves style inheritance through nesting', () => {
    const h1 = resolveBlock(block('h1', [inline('em', [text('title')])]));
    const segments = flattenInlineContent(h1.children);

    expect(segments).toHaveLength(1);
    expect(segments[0]?.style.fontSize).toBe(32);
    expect(segments[0]?.style.fontStyle).toBe('italic');
  });

  it('handles multiple inline siblings', () => {
    const p = resolveBlock(
      block('p', [
        inline('strong', [text('bold')]),
        text(' normal '),
        inline('em', [text('italic')]),
      ]),
    );
    const segments = flattenInlineContent(p.children);

    expect(segments).toHaveLength(3);
    expect(segments[0]?.style.fontWeight).toBe('bold');
    expect(segments[1]?.style.fontWeight).toBe('normal');
    expect(segments[2]?.style.fontStyle).toBe('italic');
  });

  it('returns empty array for empty block', () => {
    const p = resolveBlock(block('p', []));
    const segments = flattenInlineContent(p.children);

    expect(segments).toHaveLength(0);
  });

  it('accepts a custom parent style', () => {
    const custom = { ...DEFAULT_STYLE, fontSize: 24 };
    const p = resolveBlock(block('p', [text('big')]), custom);
    const segments = flattenInlineContent(p.children);

    expect(segments[0]?.style.fontSize).toBe(24);
  });
});
