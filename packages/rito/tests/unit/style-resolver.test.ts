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
    expect(strong?.style.fontWeight).toBe(700);
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
    expect(h1?.style.fontWeight).toBe(700);
  });

  it('heading children inherit heading style', () => {
    const result = resolveStyles([block('h1', [inline('em', [text('italic title')])])]);

    const h1 = result[0];
    const em = h1?.children[0];
    // em inherits h1's font size, adds italic
    expect(em?.style.fontSize).toBe(32);
    expect(em?.style.fontStyle).toBe('italic');
    expect(em?.style.fontWeight).toBe(700);
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
    expect(strong?.style.fontWeight).toBe(700);

    const em = strong?.children[0];
    expect(em?.style.fontWeight).toBe(700);
    expect(em?.style.fontStyle).toBe('italic');

    const textNode = em?.children[0];
    expect(textNode?.style.fontWeight).toBe(700);
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

  describe('inline style resolution', () => {
    it('applies inline style attribute to a block', () => {
      const node: DocumentNode = {
        type: NODE_TYPES.Block,
        tag: 'p',
        attributes: { style: 'color: red' },
        children: [text('hello')],
      };
      const result = resolveStyles([node]);
      expect(result[0]?.style.color).toBe('red');
    });

    it('inline style overrides tag default', () => {
      const node: DocumentNode = {
        type: NODE_TYPES.Block,
        tag: 'h1',
        attributes: { style: 'font-size: 48px' },
        children: [text('big')],
      };
      const result = resolveStyles([node]);
      // h1 default is 32, inline overrides to 48
      expect(result[0]?.style.fontSize).toBe(48);
      // h1's bold should still apply
      expect(result[0]?.style.fontWeight).toBe(700);
    });

    it('inline style on inline element', () => {
      const node: DocumentNode = {
        type: NODE_TYPES.Block,
        tag: 'p',
        children: [
          {
            type: NODE_TYPES.Inline,
            tag: 'span',
            attributes: { style: 'color: blue; font-style: italic' },
            children: [text('styled')],
          },
        ],
      };
      const result = resolveStyles([node]);
      const span = result[0]?.children[0];
      expect(span?.style.color).toBe('blue');
      expect(span?.style.fontStyle).toBe('italic');
    });

    it('inline style inherits to children', () => {
      const node: DocumentNode = {
        type: NODE_TYPES.Block,
        tag: 'p',
        attributes: { style: 'color: green' },
        children: [inline('em', [text('child')])],
      };
      const result = resolveStyles([node]);
      const em = result[0]?.children[0];
      // Child inherits parent's inline color
      expect(em?.style.color).toBe('green');
      // em adds italic
      expect(em?.style.fontStyle).toBe('italic');
    });

    it('nodes without attributes unchanged', () => {
      const result = resolveStyles([block('p', [text('plain')])]);
      expect(result[0]?.style.color).toBe('#000000');
    });
  });

  describe('stylesheet rule resolution', () => {
    it('applies matching element rule', () => {
      const rules = [
        { selector: 'p', declarations: { color: 'blue' }, rawDeclarations: 'color: blue' },
      ];
      const result = resolveStyles([block('p', [text('hi')])], undefined, rules);
      expect(result[0]?.style.color).toBe('blue');
    });

    it('applies matching class rule', () => {
      const node: DocumentNode = {
        type: NODE_TYPES.Block,
        tag: 'p',
        attributes: { class: 'intro' },
        children: [text('hi')],
      };
      const rules = [
        {
          selector: '.intro',
          declarations: { textIndent: 32 },
          rawDeclarations: 'text-indent: 32px',
        },
      ];
      const result = resolveStyles([node], undefined, rules);
      expect(result[0]?.style.textIndent).toBe(32);
    });

    it('higher specificity wins', () => {
      const node: DocumentNode = {
        type: NODE_TYPES.Block,
        tag: 'p',
        attributes: { class: 'red' },
        children: [text('hi')],
      };
      const rules = [
        { selector: 'p', declarations: { color: 'blue' }, rawDeclarations: 'color: blue' },
        { selector: '.red', declarations: { color: 'red' }, rawDeclarations: 'color: red' },
      ];
      const result = resolveStyles([node], undefined, rules);
      expect(result[0]?.style.color).toBe('red');
    });

    it('inline style overrides stylesheet rule', () => {
      const node: DocumentNode = {
        type: NODE_TYPES.Block,
        tag: 'p',
        attributes: { style: 'color: green' },
        children: [text('hi')],
      };
      const rules = [
        { selector: 'p', declarations: { color: 'blue' }, rawDeclarations: 'color: blue' },
      ];
      const result = resolveStyles([node], undefined, rules);
      expect(result[0]?.style.color).toBe('green');
    });

    it('non-matching rules are ignored', () => {
      const rules = [
        { selector: '.nonexistent', declarations: { color: 'red' }, rawDeclarations: 'color: red' },
      ];
      const result = resolveStyles([block('p', [text('hi')])], undefined, rules);
      expect(result[0]?.style.color).toBe('#000000');
    });

    it('resolves em margins against element font-size, not base', () => {
      const node: DocumentNode = {
        type: NODE_TYPES.Block,
        tag: 'p',
        attributes: { class: 'big' },
        children: [text('hello')],
      };
      const rules = [
        {
          selector: '.big',
          declarations: { fontSize: 32 },
          rawDeclarations: 'font-size: 32px; margin-top: 0.5em',
        },
      ];
      const result = resolveStyles([node], undefined, rules);
      // margin-top: 0.5em should resolve against fontSize=32, giving 16
      expect(result[0]?.style.fontSize).toBe(32);
      expect(result[0]?.style.marginTop).toBe(16);
    });

    it('works without rules (backward compatible)', () => {
      const result = resolveStyles([block('p', [text('hi')])]);
      expect(result[0]?.style.color).toBe('#000000');
    });
  });
});
