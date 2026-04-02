import { describe, expect, it } from 'vitest';
import { resolveStyles } from '../../src/style/resolver';
import { DEFAULT_STYLE } from '../../src/style/defaults';
import type { BlockNode, DocumentNode, InlineNode, TextNode } from '../../src/parser/xhtml/types';
import { NODE_TYPES } from '../../src/parser/xhtml/types';

function text(content: string): TextNode {
  return { type: NODE_TYPES.Text, content };
}

function inline(tag: string, children: DocumentNode[]): InlineNode {
  return { type: NODE_TYPES.Inline, tag, children };
}

function block(tag: string, children: DocumentNode[]): BlockNode {
  return { type: NODE_TYPES.Block, tag, children };
}

describe('resolveStyles', () => {
  it('applies default style to text nodes', () => {
    const result = resolveStyles([text('hello')]);

    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe('text');
    expect(result[0]?.content).toBe('hello');
    expect(result[0]?.style).toEqual(DEFAULT_STYLE);
  });

  it('applies default style to a plain block', () => {
    const result = resolveStyles([block('div', [text('content')])]);

    expect(result).toHaveLength(1);
    const div = result[0];
    expect(div?.type).toBe('block');
    // div has no tag style overrides, inherits default
    expect(div?.style).toEqual(DEFAULT_STYLE);
  });

  it('applies tag-based overrides to <strong>', () => {
    const result = resolveStyles([block('p', [inline('strong', [text('bold')])])]);

    const p = result[0];
    const strong = p?.children[0];
    expect(strong?.style.fontWeight).toBe('bold');
    // Other properties inherited from parent
    expect(strong?.style.fontFamily).toBe('serif');
  });

  it('applies tag-based overrides to <em>', () => {
    const result = resolveStyles([block('p', [inline('em', [text('italic')])])]);

    const em = result[0]?.children[0];
    expect(em?.style.fontStyle).toBe('italic');
  });

  it('applies heading font size', () => {
    const result = resolveStyles([block('h1', [text('Title')])]);

    const h1 = result[0];
    expect(h1?.style.fontSize).toBe(32);
    expect(h1?.style.fontWeight).toBe('bold');
  });

  it('heading children inherit heading style', () => {
    const result = resolveStyles([block('h1', [inline('em', [text('italic title')])])]);

    const h1 = result[0];
    const em = h1?.children[0];
    // em inherits h1's font size, adds italic
    expect(em?.style.fontSize).toBe(32);
    expect(em?.style.fontStyle).toBe('italic');
    expect(em?.style.fontWeight).toBe('bold');
  });

  it('applies monospace for <pre>', () => {
    const result = resolveStyles([block('pre', [text('code here')])]);

    const pre = result[0];
    expect(pre?.style.fontFamily).toBe('monospace');
    // Text inside pre inherits monospace
    expect(pre?.children[0]?.style.fontFamily).toBe('monospace');
  });

  it('applies monospace for inline <code>', () => {
    const result = resolveStyles([block('p', [inline('code', [text('x')])])]);

    const code = result[0]?.children[0];
    expect(code?.style.fontFamily).toBe('monospace');
  });

  it('stacks nested inline overrides', () => {
    // <p><strong><em>bold italic</em></strong></p>
    const result = resolveStyles([
      block('p', [inline('strong', [inline('em', [text('bold italic')])])]),
    ]);

    const strong = result[0]?.children[0];
    expect(strong?.style.fontWeight).toBe('bold');

    const em = strong?.children[0];
    expect(em?.style.fontWeight).toBe('bold');
    expect(em?.style.fontStyle).toBe('italic');

    const textNode = em?.children[0];
    expect(textNode?.style.fontWeight).toBe('bold');
    expect(textNode?.style.fontStyle).toBe('italic');
  });

  it('applies margins to block elements', () => {
    const result = resolveStyles([block('p', [text('content')])]);

    const p = result[0];
    expect(p?.style.marginTop).toBe(16);
    expect(p?.style.marginBottom).toBe(16);
  });

  it('accepts a custom parent style', () => {
    const custom = { ...DEFAULT_STYLE, fontSize: 20, color: '#333333' };
    const result = resolveStyles([text('hello')], custom);

    expect(result[0]?.style.fontSize).toBe(20);
    expect(result[0]?.style.color).toBe('#333333');
  });

  it('resolves multiple sibling nodes', () => {
    const result = resolveStyles([block('h1', [text('Title')]), block('p', [text('Body')])]);

    expect(result).toHaveLength(2);
    expect(result[0]?.style.fontSize).toBe(32);
    expect(result[1]?.style.fontSize).toBe(16);
  });

  it('preserves text content through resolution', () => {
    const result = resolveStyles([block('p', [text('hello'), inline('em', [text('world')])])]);

    const p = result[0];
    expect(p?.children[0]?.content).toBe('hello');
    expect(p?.children[1]?.children[0]?.content).toBe('world');
  });
});
