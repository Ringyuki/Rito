import { describe, expect, it } from 'vitest';
import { resolveStyles } from '../../src/reference/ts-core/style/cascade/resolver';
import { DEFAULT_STYLE } from '../../src/reference/ts-core/style/core/defaults';
import type {
  BlockNode,
  DocumentNode,
  ElementAttributes,
  InlineNode,
  TextNode,
} from '../../src/reference/ts-core/parser/xhtml/types';
import { NODE_TYPES } from '../../src/reference/ts-core/parser/xhtml/types';

function text(content: string): TextNode {
  return { type: NODE_TYPES.Text, content };
}

function inline(tag: string, children: DocumentNode[], attributes?: ElementAttributes): InlineNode {
  return { type: NODE_TYPES.Inline, tag, children, ...(attributes ? { attributes } : {}) };
}

function block(tag: string, children: DocumentNode[], attributes?: ElementAttributes): BlockNode {
  return { type: NODE_TYPES.Block, tag, children, ...(attributes ? { attributes } : {}) };
}

function image(src = 'cover.jpg', alt = '', attributes?: ElementAttributes): DocumentNode {
  return { type: 'image', src, alt, ...(attributes ? { attributes } : {}) };
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

  it('applies user-agent defaults to <strong>', () => {
    const result = resolveStyles([block('p', [inline('strong', [text('bold')])])]);

    const p = result[0];
    const strong = p?.children[0];
    expect(strong?.style.fontWeight).toBe(700);
    // Other properties inherited from parent
    expect(strong?.style.fontFamily).toBe('serif');
  });

  it('applies user-agent defaults to <em>', () => {
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

  it('inherits language attributes into descendant computed styles', () => {
    const result = resolveStyles([
      block('section', [block('p', [inline('span', [text('本文')])])], { language: 'JA' }),
    ]);

    const section = result[0];
    const paragraph = section?.children[0];
    const span = paragraph?.children[0];
    const textNode = span?.children[0];

    expect(section?.style.language).toBe('ja');
    expect(paragraph?.style.language).toBe('ja');
    expect(span?.style.language).toBe('ja');
    expect(textNode?.style.language).toBe('ja');
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

    it('author rules override user-agent defaults regardless of lower specificity', () => {
      const rules = [
        {
          selector: '*',
          declarations: { fontWeight: 400 },
          rawDeclarations: 'font-weight: normal',
        },
      ];

      const result = resolveStyles([block('h1', [text('Title')])], undefined, rules);

      expect(result[0]?.style.fontWeight).toBe(400);
      expect(result[0]?.style.fontSize).toBe(32);
    });

    it('author universal reset clears user-agent heading margins', () => {
      const rules = [
        {
          selector: '*',
          declarations: { marginTop: 0, marginBottom: 0 },
          rawDeclarations: 'margin: 0',
        },
      ];

      const result = resolveStyles([block('h2', [text('Cover')])], undefined, rules);

      expect(result[0]?.style.marginTop).toBe(0);
      expect(result[0]?.style.marginBottom).toBe(0);
      expect(result[0]?.style.fontSize).toBe(24);
    });

    it('author rules resolve margins after overriding user-agent font-size', () => {
      const rules = [
        {
          selector: 'p',
          declarations: {},
          rawDeclarations: 'font-size: 0.9em; margin-top: 1em; margin-bottom: 1em',
        },
      ];

      const result = resolveStyles([block('p', [text('Body')])], undefined, rules);

      expect(result[0]?.style.fontSize).toBeCloseTo(14.4);
      expect(result[0]?.style.marginTop).toBeCloseTo(14.4);
      expect(result[0]?.style.marginBottom).toBeCloseTo(14.4);
    });

    it('applies runtime image defaults separately from user-agent CSS', () => {
      const result = resolveStyles([image()]);

      expect(result[0]?.style.objectFit).toBe('contain');
      expect(result[0]?.style.boxSizing).toBe('border-box');
    });

    it('author image rules override runtime image defaults', () => {
      const rules = [
        {
          selector: 'img',
          declarations: { objectFit: 'cover' as const },
          rawDeclarations: 'object-fit: cover',
        },
      ];
      const result = resolveStyles([image()], undefined, rules);

      expect(result[0]?.style.objectFit).toBe('cover');
      expect(result[0]?.style.boxSizing).toBe('border-box');
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

  describe('nested em font-size resolution', () => {
    it('resolves em font-size on span relative to parent computed font-size', () => {
      // <p class="em26"><span class="em04">vol.</span></p>
      // p: font-size: 2.6em → 2.6 * 16 = 41.6px
      // span: font-size: 0.4em → 0.4 * 41.6 = 16.64px (NOT 0.4 * 16 = 6.4!)
      const rules = [
        { selector: '.em26', declarations: {}, rawDeclarations: 'font-size: 2.6em' },
        { selector: '.em04', declarations: {}, rawDeclarations: 'font-size: 0.4em' },
      ];
      const node: DocumentNode = {
        type: NODE_TYPES.Block,
        tag: 'p',
        attributes: { class: 'em26' },
        children: [
          {
            type: NODE_TYPES.Inline,
            tag: 'span',
            attributes: { class: 'em04' },
            children: [text('vol.')],
          },
        ],
      };
      const result = resolveStyles([node], undefined, rules);
      const p = result[0];
      expect(p?.style.fontSize).toBeCloseTo(41.6); // 2.6 * 16

      const span = p?.children[0];
      expect(span?.style.fontSize).toBeCloseTo(16.64); // 0.4 * 41.6
    });

    it('resolves em12 span inside em26 parent correctly', () => {
      const rules = [
        { selector: '.em26', declarations: {}, rawDeclarations: 'font-size: 2.6em' },
        { selector: '.em12', declarations: {}, rawDeclarations: 'font-size: 1.2em' },
      ];
      const node: DocumentNode = {
        type: NODE_TYPES.Block,
        tag: 'p',
        attributes: { class: 'em26' },
        children: [
          {
            type: NODE_TYPES.Inline,
            tag: 'span',
            attributes: { class: 'em12' },
            children: [text('1')],
          },
        ],
      };
      const result = resolveStyles([node], undefined, rules);
      const span = result[0]?.children[0];
      expect(span?.style.fontSize).toBeCloseTo(49.92); // 1.2 * 41.6
    });

    it('h1 em font-size resolves against parent, not tag default', () => {
      // h1 UA default: font-size=2em. Parent body: fontSize=16.
      // CSS: h1 { font-size: 1.5em } → should be 1.5 * 16 = 24, NOT 1.5 * 32 = 48
      const rules = [{ selector: 'h1', declarations: {}, rawDeclarations: 'font-size: 1.5em' }];
      const result = resolveStyles([block('h1', [text('Title')])], undefined, rules);
      expect(result[0]?.style.fontSize).toBeCloseTo(24); // 1.5 * 16 (parent)
    });

    it('h2 em font-size resolves against parent, not tag default of 24', () => {
      const rules = [{ selector: 'h2', declarations: {}, rawDeclarations: 'font-size: 2em' }];
      const result = resolveStyles([block('h2', [text('Heading')])], undefined, rules);
      // h2 UA default is 1.5em, but author em should use parent (16) → 2 * 16 = 32
      expect(result[0]?.style.fontSize).toBeCloseTo(32);
    });
  });

  describe('sibling selectors at root level', () => {
    it('p + p matches second paragraph at root level', () => {
      const rules = [
        { selector: 'p + p', declarations: { color: 'red' }, rawDeclarations: 'color: red' },
      ];
      const result = resolveStyles(
        [block('p', [text('A')]), block('p', [text('B')])],
        undefined,
        rules,
      );
      expect(result[0]?.style.color).toBe('#000000'); // first p: no match
      expect(result[1]?.style.color).toBe('red'); // second p: match
    });

    it(':first-child matches first root element', () => {
      const rules = [
        {
          selector: 'p:first-child',
          declarations: { color: 'blue' },
          rawDeclarations: 'color: blue',
        },
      ];
      const result = resolveStyles(
        [block('p', [text('First')]), block('p', [text('Second')])],
        undefined,
        rules,
      );
      expect(result[0]?.style.color).toBe('blue');
      expect(result[1]?.style.color).toBe('#000000');
    });

    it(':last-child matches last root element', () => {
      const rules = [
        {
          selector: 'p:last-child',
          declarations: { color: 'green' },
          rawDeclarations: 'color: green',
        },
      ];
      const result = resolveStyles(
        [block('p', [text('First')]), block('p', [text('Last')])],
        undefined,
        rules,
      );
      expect(result[0]?.style.color).toBe('#000000');
      expect(result[1]?.style.color).toBe('green');
    });

    it('p + img matches image target at root level', () => {
      const rules = [
        { selector: 'p + img', declarations: { color: 'red' }, rawDeclarations: 'color: red' },
      ];
      const result = resolveStyles([block('p', [text('A')]), image()], undefined, rules);

      expect(result[0]?.style.color).toBe('#000000');
      expect(result[1]?.type).toBe('image');
      expect(result[1]?.style.color).toBe('red');
    });

    it('img:first-child matches first root image', () => {
      const rules = [
        {
          selector: 'img:first-child',
          declarations: { color: 'blue' },
          rawDeclarations: 'color: blue',
        },
      ];
      const result = resolveStyles([image(), block('p', [text('Body')])], undefined, rules);

      expect(result[0]?.type).toBe('image');
      expect(result[0]?.style.color).toBe('blue');
      expect(result[1]?.style.color).toBe('#000000');
    });

    it('img:last-child matches last root image', () => {
      const rules = [
        {
          selector: 'img:last-child',
          declarations: { color: 'green' },
          rawDeclarations: 'color: green',
        },
      ];
      const result = resolveStyles([block('p', [text('Lead')]), image()], undefined, rules);

      expect(result[0]?.style.color).toBe('#000000');
      expect(result[1]?.type).toBe('image');
      expect(result[1]?.style.color).toBe('green');
    });
  });
});
