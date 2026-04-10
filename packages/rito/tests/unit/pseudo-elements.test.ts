import { describe, expect, it } from 'vitest';
import { resolveStyles } from '../../src/style/cascade/resolver';
import { extractPseudoElement, stripPseudoElement } from '../../src/style/cascade/selector-matcher';
import { calculateSpecificity } from '../../src/style/cascade/specificity';
import { parseCssRules } from '../../src/style/css/rule-parser';
import type { BlockNode, DocumentNode, InlineNode, TextNode } from '../../src/parser/xhtml/types';
import { NODE_TYPES } from '../../src/parser/xhtml/types';

const BASE = 16;

function text(content: string): TextNode {
  return { type: NODE_TYPES.Text, content };
}

function inline(tag: string, children: DocumentNode[]): InlineNode {
  return { type: NODE_TYPES.Inline, tag, children };
}

function block(tag: string, children: DocumentNode[]): BlockNode {
  return { type: NODE_TYPES.Block, tag, children };
}

describe('extractPseudoElement', () => {
  it('extracts ::before', () => {
    expect(extractPseudoElement('h2::before')).toBe('before');
  });

  it('extracts ::after', () => {
    expect(extractPseudoElement('.intro::after')).toBe('after');
  });

  it('handles legacy single-colon :before', () => {
    expect(extractPseudoElement('p:before')).toBe('before');
  });

  it('handles legacy single-colon :after', () => {
    expect(extractPseudoElement('p:after')).toBe('after');
  });

  it('returns undefined for plain selector', () => {
    expect(extractPseudoElement('h2')).toBeUndefined();
  });

  it('returns undefined for pseudo-class', () => {
    expect(extractPseudoElement('p:first-child')).toBeUndefined();
  });
});

describe('stripPseudoElement', () => {
  it('strips ::before', () => {
    expect(stripPseudoElement('h2::before')).toBe('h2');
  });

  it('strips :after (legacy)', () => {
    expect(stripPseudoElement('.intro:after')).toBe('.intro');
  });

  it('leaves non-pseudo selector unchanged', () => {
    expect(stripPseudoElement('p.intro')).toBe('p.intro');
  });
});

describe('specificity with pseudo-elements', () => {
  it('h2::before = [0,0,2]', () => {
    expect(calculateSpecificity('h2::before')).toEqual([0, 0, 2]);
  });

  it('::before = [0,0,1]', () => {
    expect(calculateSpecificity('::before')).toEqual([0, 0, 1]);
  });

  it('.intro::after = [0,1,1]', () => {
    expect(calculateSpecificity('.intro::after')).toEqual([0, 1, 1]);
  });

  it('#ch1::before = [1,0,1]', () => {
    expect(calculateSpecificity('#ch1::before')).toEqual([1, 0, 1]);
  });

  it('h2:before (legacy) = [0,0,2]', () => {
    expect(calculateSpecificity('h2:before')).toEqual([0, 0, 2]);
  });
});

describe('resolveStyles with ::before/::after', () => {
  it('injects ::before text as first inline child', () => {
    const rules = parseCssRules('h2::before { content: "Chapter "; }', BASE);
    const result = resolveStyles([block('h2', [text('Introduction')])], undefined, rules);

    const h2 = result[0];
    expect(h2?.children).toHaveLength(2);

    const beforeNode = h2?.children[0];
    expect(beforeNode?.type).toBe('inline');
    expect(beforeNode?.children).toHaveLength(1);
    expect(beforeNode?.children[0]?.type).toBe('text');
    expect(beforeNode?.children[0]?.content).toBe('Chapter ');

    expect(h2?.children[1]?.type).toBe('text');
    expect(h2?.children[1]?.content).toBe('Introduction');
  });

  it('injects ::after text as last inline child', () => {
    const rules = parseCssRules('p::after { content: "."; }', BASE);
    const result = resolveStyles([block('p', [text('Hello')])], undefined, rules);

    const p = result[0];
    expect(p?.children).toHaveLength(2);
    expect(p?.children[0]?.content).toBe('Hello');

    const afterNode = p?.children[1];
    expect(afterNode?.type).toBe('inline');
    expect(afterNode?.children[0]?.content).toBe('.');
  });

  it('injects both ::before and ::after', () => {
    const css =
      'blockquote::before { content: "\\201C"; } blockquote::after { content: "\\201D"; }';
    const rules = parseCssRules(css, BASE);
    const result = resolveStyles([block('blockquote', [text('Quote')])], undefined, rules);

    const bq = result[0];
    expect(bq?.children).toHaveLength(3);
    expect(bq?.children[0]?.children[0]?.content).toBe('\u201C');
    expect(bq?.children[1]?.content).toBe('Quote');
    expect(bq?.children[2]?.children[0]?.content).toBe('\u201D');
  });

  it('does not inject when content is none', () => {
    const rules = parseCssRules('h2::before { content: none; color: red; }', BASE);
    const result = resolveStyles([block('h2', [text('Title')])], undefined, rules);

    expect(result[0]?.children).toHaveLength(1);
    expect(result[0]?.children[0]?.content).toBe('Title');
  });

  it('does not inject when content is not declared', () => {
    const rules = parseCssRules('h2::before { color: red; }', BASE);
    const result = resolveStyles([block('h2', [text('Title')])], undefined, rules);

    expect(result[0]?.children).toHaveLength(1);
  });

  it('suppresses pseudo-element with display: none', () => {
    const rules = parseCssRules('h2::before { content: "X"; display: none; }', BASE);
    const result = resolveStyles([block('h2', [text('Title')])], undefined, rules);

    expect(result[0]?.children).toHaveLength(1);
  });

  it('pseudo-element inherits parent font style', () => {
    const rules = parseCssRules('h2::before { content: "→ "; }', BASE);
    const result = resolveStyles([block('h2', [text('Title')])], undefined, rules);

    const h2 = result[0];
    const before = h2?.children[0];
    // h2 has fontWeight 700 from tag defaults; pseudo-element inherits it
    expect(before?.style.fontWeight).toBe(h2?.style.fontWeight);
  });

  it('pseudo-element applies its own styles over inherited', () => {
    const rules = parseCssRules('h2::before { content: "§"; color: blue; }', BASE);
    const result = resolveStyles([block('h2', [text('Title')])], undefined, rules);

    const before = result[0]?.children[0];
    expect(before?.style.color).toBe('blue');
  });

  it('works with class selectors', () => {
    const rules = parseCssRules('.chapter::before { content: "Ch. "; }', BASE);
    const nodes: DocumentNode[] = [
      {
        type: NODE_TYPES.Block,
        tag: 'h2',
        children: [text('One')],
        attributes: { class: 'chapter' },
      },
    ];
    const result = resolveStyles(nodes, undefined, rules);

    expect(result[0]?.children).toHaveLength(2);
    expect(result[0]?.children[0]?.children[0]?.content).toBe('Ch. ');
  });

  it('does not apply pseudo-element rule to non-matching element', () => {
    const rules = parseCssRules('h3::before { content: "X"; }', BASE);
    const result = resolveStyles([block('h2', [text('Title')])], undefined, rules);

    expect(result[0]?.children).toHaveLength(1);
  });

  it('injects empty content string (decorative box)', () => {
    const rules = parseCssRules('hr::after { content: ""; }', BASE);
    const result = resolveStyles([block('hr', [])], undefined, rules);

    const hr = result[0];
    expect(hr?.children).toHaveLength(1);
    expect(hr?.children[0]?.children[0]?.content).toBe('');
  });

  it('works on inline elements', () => {
    const rules = parseCssRules('span::before { content: "["; }', BASE);
    const result = resolveStyles([block('p', [inline('span', [text('link')])])], undefined, rules);

    const span = result[0]?.children[0];
    expect(span?.children).toHaveLength(2);
    expect(span?.children[0]?.children[0]?.content).toBe('[');
    expect(span?.children[1]?.content).toBe('link');
  });

  it('matches parent > child::before (child combinator)', () => {
    const rules = parseCssRules('div > p::before { content: "→ "; }', BASE);
    const nodes: DocumentNode[] = [block('div', [block('p', [text('Hello')])])];
    const result = resolveStyles(nodes, undefined, rules);

    const div = result[0];
    const p = div?.children[0];
    expect(p?.children).toHaveLength(2);
    expect(p?.children[0]?.children[0]?.content).toBe('→ ');
  });

  it('creates block pseudo-element for display: block', () => {
    const rules = parseCssRules('hr::after { content: ""; display: block; }', BASE);
    const result = resolveStyles([block('hr', [])], undefined, rules);

    const hr = result[0];
    expect(hr?.children).toHaveLength(1);
    const after = hr?.children[0];
    expect(after?.type).toBe('block');
    expect(after?.children[0]?.content).toBe('');
  });

  it('bare ::before matches any element', () => {
    const rules = parseCssRules('::before { content: "*"; }', BASE);
    const result = resolveStyles([block('p', [text('Hi')])], undefined, rules);

    expect(result[0]?.children).toHaveLength(2);
    expect(result[0]?.children[0]?.children[0]?.content).toBe('*');
  });

  it('wraps inline siblings in anonymous block when block pseudo is present', () => {
    const rules = parseCssRules('p::before { content: "X"; display: block; }', BASE);
    const result = resolveStyles([block('p', [text('Hello')])], undefined, rules);

    const p = result[0];
    // children: [block ::before, anonymous block wrapping "Hello"]
    expect(p?.children).toHaveLength(2);
    expect(p?.children[0]?.type).toBe('block');
    expect(p?.children[0]?.children[0]?.content).toBe('X');
    // "Hello" wrapped in anonymous block
    const anonBlock = p?.children[1];
    expect(anonBlock?.type).toBe('block');
    expect(anonBlock?.children[0]?.content).toBe('Hello');
  });

  it('demotes block pseudo to inline on inline host', () => {
    const rules = parseCssRules('span::before { content: "X"; display: block; }', BASE);
    const result = resolveStyles([block('p', [inline('span', [text('Hello')])])], undefined, rules);

    const span = result[0]?.children[0];
    expect(span?.children).toHaveLength(2);
    // Block pseudo demoted to inline inside inline host
    const before = span?.children[0];
    expect(before?.type).toBe('inline');
    expect(before?.style.display).toBe('inline');
    expect(before?.children[0]?.content).toBe('X');
    // Original text preserved
    expect(span?.children[1]?.content).toBe('Hello');
  });

  it('anonymous block wrapper does not copy host box model', () => {
    const rules = parseCssRules(
      'p { padding-left: 20px; } p::before { content: "X"; display: block; }',
      BASE,
    );
    const result = resolveStyles([block('p', [text('Hello')])], undefined, rules);

    const p = result[0];
    expect(p?.style.paddingLeft).toBe(20);
    // Anonymous block wrapper should NOT have padding from host
    const anonBlock = p?.children[1];
    expect(anonBlock?.type).toBe('block');
    expect(anonBlock?.style.paddingLeft).toBe(0);
  });
});
