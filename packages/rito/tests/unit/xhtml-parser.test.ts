import { describe, expect, it } from 'vitest';
import { parseXhtml } from '../../src/reference/ts-core/parser/xhtml/xhtml-parser';
import {
  estimateNormalizedXhtmlSourceLength,
  isXhtmlSourceWithinNormalizationBudget,
  normalizeXhtmlSource,
} from '../../src/reference/ts-core/parser/xhtml/xhtml-source-normalizer';
import { XhtmlParseError } from '../../src/reference/ts-core/parser/xhtml/errors';
import type {
  BlockNode,
  InlineNode,
  TextNode,
} from '../../src/reference/ts-core/parser/xhtml/types';

function xhtml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Test</title></head>
  <body>${body}</body>
</html>`;
}

describe('parseXhtml', () => {
  describe('basic structure', () => {
    it('parses a simple paragraph', () => {
      const { nodes } = parseXhtml(xhtml('<p>Hello</p>'));

      expect(nodes).toHaveLength(1);
      const p = nodes[0] as BlockNode;
      expect(p.type).toBe('block');
      expect(p.tag).toBe('p');
      expect(p.children).toHaveLength(1);
      expect((p.children[0] as TextNode).content).toBe('Hello');
    });

    it('parses multiple blocks', () => {
      const { nodes } = parseXhtml(xhtml('<h1>Title</h1><p>Body</p>'));

      const blocks = nodes.filter((n) => n.type === 'block');
      expect(blocks).toHaveLength(2);
      expect((blocks[0] as BlockNode).tag).toBe('h1');
      expect((blocks[1] as BlockNode).tag).toBe('p');
    });

    it('parses nested blocks', () => {
      const { nodes } = parseXhtml(xhtml('<div><p>Inner</p></div>'));

      expect(nodes).toHaveLength(1);
      const div = nodes[0] as BlockNode;
      expect(div.tag).toBe('div');
      expect(div.children).toHaveLength(1);
      expect((div.children[0] as BlockNode).tag).toBe('p');
    });

    it('ignores comments, processing instructions, and body CDATA without shifting paths', () => {
      const { nodes } = parseXhtml(
        xhtml(
          '<!-- before --><?reader test?><p>A<!-- middle -->B<?reader middle?>C<![CDATA[ignored]]>D</p>',
        ),
      );

      const paragraph = nodes[0] as BlockNode;
      expect(paragraph.sourceRef?.nodePath).toEqual([0]);
      expect(paragraph.children).toMatchObject([
        { type: 'text', content: 'A', sourceRef: { nodePath: [0, 0] } },
        { type: 'text', content: 'B', sourceRef: { nodePath: [0, 1] } },
        { type: 'text', content: 'C', sourceRef: { nodePath: [0, 2] } },
        { type: 'text', content: 'D', sourceRef: { nodePath: [0, 3] } },
      ]);
    });

    it('extracts embedded styles from CDATA sections', () => {
      const source = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><style><![CDATA[p { color: red; }]]></style></head>
  <body><p>Text</p></body>
</html>`;

      expect(parseXhtml(source).embeddedStylesheets).toEqual(['p { color: red; }']);
    });
  });

  describe('EPUB XHTML compatibility', () => {
    it('accepts single quoted XML declaration attributes', () => {
      const source = `<?xml version='1.0' encoding='utf-8'?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body><p>Hello</p></body>
</html>`;

      const { nodes } = parseXhtml(source);

      expect((nodes[0] as BlockNode).tag).toBe('p');
    });

    it('normalizes XHTML nbsp entities before XML parsing', () => {
      const { nodes } = parseXhtml(xhtml('<p>Hello&nbsp;world</p>'));

      const p = nodes[0] as BlockNode;
      expect((p.children[0] as TextNode).content).toBe('Hello\u00A0world');
    });

    it('keeps a raw ampersand as literal text instead of aborting the parse', () => {
      // Regression: real EPUB chapters contain unescaped `&` (e.g. "Schmidt & Bender").
      // A strict application/xhtml+xml parser otherwise fails with "EntityRef: expecting ';'".
      const { nodes } = parseXhtml(
        xhtml('<p>\u65BD\u5BC6\u7279&\u73ED\u7279\u578B\u7784\u51C6\u955C</p>'),
      );

      const p = nodes[0] as BlockNode;
      expect((p.children[0] as TextNode).content).toBe(
        '\u65BD\u5BC6\u7279&\u73ED\u7279\u578B\u7784\u51C6\u955C',
      );
    });

    it('preserves a raw ampersand inside an attribute value', () => {
      const { nodes } = parseXhtml(xhtml('<p><a href="page?a=1&b=2">link</a></p>'));

      const a = (nodes[0] as BlockNode).children[0] as InlineNode;
      expect(a.tag).toBe('a');
      expect(a.attributes?.href).toBe('page?a=1&b=2');
    });

    it('remaps HTML named entities undefined in XML to their characters', () => {
      const { nodes } = parseXhtml(xhtml('<p>A&copy;B&mdash;C&hellip;D&rsquo;E</p>'));

      const p = nodes[0] as BlockNode;
      expect((p.children[0] as TextNode).content).toBe('A\u00A9B\u2014C\u2026D\u2019E');
    });

    it('preserves valid numeric character references', () => {
      const { nodes } = parseXhtml(xhtml('<p>&#160;&#x40;&#8212;</p>'));

      const p = nodes[0] as BlockNode;
      expect((p.children[0] as TextNode).content).toBe('\u00A0@\u2014');
    });

    it('escapes an unknown named entity to literal text', () => {
      const { nodes } = parseXhtml(xhtml('<p>x&notarealentity;y</p>'));

      const p = nodes[0] as BlockNode;
      expect((p.children[0] as TextNode).content).toBe('x&notarealentity;y');
    });
  });

  // Source normalization is a pure string transform applied before XML parsing.
  describe('source normalization', () => {
    it('estimates the exact normalized length without expanding preserved ampersands', () => {
      const source = '<p>&amp; &copy; &unknown; & <![CDATA[&&&&]]><!-- && --></p>';

      expect(estimateNormalizedXhtmlSourceLength(source)).toBe(normalizeXhtmlSource(source).length);
    });

    it('bounds raw input even when normalization would discard most of it', () => {
      const source = `<p/>${'\u0000'.repeat(10)}`;

      expect(estimateNormalizedXhtmlSourceLength(source)).toBe(4);
      expect(isXhtmlSourceWithinNormalizationBudget(source, 5)).toBe(false);
    });

    it('does not charge preserved CDATA ampersands as expansions', () => {
      const source = '<![CDATA[&&&&]]>';

      expect(isXhtmlSourceWithinNormalizationBudget(source, source.length)).toBe(true);
    });

    it('escapes a raw ampersand to a valid entity', () => {
      expect(normalizeXhtmlSource('<p>a & b</p>')).toBe('<p>a &amp; b</p>');
    });

    it('remaps known HTML named entities to numeric references', () => {
      expect(normalizeXhtmlSource('<p>&copy;&mdash;&nbsp;</p>')).toBe('<p>&#169;&#8212;&#160;</p>');
    });

    it('preserves valid numeric and XML-predefined references', () => {
      expect(normalizeXhtmlSource('<p>&#160;&#x40;&amp;&lt;&gt;</p>')).toBe(
        '<p>&#160;&#x40;&amp;&lt;&gt;</p>',
      );
    });

    it('escapes an unknown named entity', () => {
      expect(normalizeXhtmlSource('<p>&bogus;</p>')).toBe('<p>&amp;bogus;</p>');
    });

    it('leaves ampersands inside comments untouched', () => {
      expect(normalizeXhtmlSource('<!-- a && b & c --><p>x & y</p>')).toBe(
        '<!-- a && b & c --><p>x &amp; y</p>',
      );
    });

    it('leaves ampersands inside CDATA sections untouched', () => {
      expect(normalizeXhtmlSource('<p>x & y<![CDATA[ a && b & c ]]>z & w</p>')).toBe(
        '<p>x &amp; y<![CDATA[ a && b & c ]]>z &amp; w</p>',
      );
    });

    it('strips control characters illegal in XML, keeping TAB/LF/CR', () => {
      // U+001F (Unit Separator) is illegal PCDATA; tab/newline/CR are legal.
      const input = '<p>“\u001F? ok”\tline\nbreak\r</p>';
      expect(normalizeXhtmlSource(input)).toBe('<p>“? ok”\tline\nbreak\r</p>');
    });

    it('preserves valid astral characters (surrogate pairs)', () => {
      expect(normalizeXhtmlSource('<p>emoji 😀 漢字</p>')).toBe('<p>emoji 😀 漢字</p>');
    });

    it('drops numeric references that point to illegal characters', () => {
      expect(normalizeXhtmlSource('<p>a&#31;b&#x1F;c&#0;d</p>')).toBe('<p>abcd</p>');
    });
  });

  describe('inline elements', () => {
    it('parses inline elements within a block', () => {
      const { nodes } = parseXhtml(xhtml('<p>Hello <em>world</em></p>'));

      const p = nodes[0] as BlockNode;
      expect(p.children).toHaveLength(2);

      const text = p.children[0] as TextNode;
      expect(text.type).toBe('text');
      expect(text.content).toBe('Hello ');

      const em = p.children[1] as InlineNode;
      expect(em.type).toBe('inline');
      expect(em.tag).toBe('em');
      expect((em.children[0] as TextNode).content).toBe('world');
    });

    it('parses nested inline elements', () => {
      const { nodes } = parseXhtml(xhtml('<p><strong><em>bold italic</em></strong></p>'));

      const p = nodes[0] as BlockNode;
      const strong = p.children[0] as InlineNode;
      expect(strong.tag).toBe('strong');

      const em = strong.children[0] as InlineNode;
      expect(em.tag).toBe('em');
      expect((em.children[0] as TextNode).content).toBe('bold italic');
    });
  });

  describe('whitespace normalization', () => {
    it('collapses consecutive whitespace', () => {
      const { nodes } = parseXhtml(xhtml('<p>hello   world</p>'));

      const p = nodes[0] as BlockNode;
      expect((p.children[0] as TextNode).content).toBe('hello world');
    });

    it('collapses newlines and tabs', () => {
      const { nodes } = parseXhtml(xhtml('<p>hello\n\t  world</p>'));

      const p = nodes[0] as BlockNode;
      expect((p.children[0] as TextNode).content).toBe('hello world');
    });

    it('preserves whitespace in <pre> elements', () => {
      const { nodes } = parseXhtml(xhtml('<pre>  hello\n  world  </pre>'));

      const pre = nodes[0] as BlockNode;
      expect(pre.tag).toBe('pre');

      const text = pre.children[0] as TextNode;
      expect(text.content).toContain('  hello\n  world  ');
    });

    it('keeps single-space text nodes between inline elements', () => {
      const { nodes } = parseXhtml(xhtml('<p><em>a</em> <strong>b</strong></p>'));

      const p = nodes[0] as BlockNode;
      // Should have: em, text(" "), strong
      const textNodes = p.children.filter((c): c is TextNode => c.type === 'text');
      expect(textNodes.some((t) => t.content === ' ')).toBe(true);
    });

    it('preserves Unicode spaces while collapsing ASCII HTML whitespace', () => {
      const { nodes } = parseXhtml(xhtml('<p> [ S  P E C ]</p>'));

      const p = nodes[0] as BlockNode;
      expect((p.children[0] as TextNode).content).toBe(' [ S P E C ]');
    });
  });

  describe('br handling', () => {
    it('converts <br/> to a newline text node', () => {
      const { nodes } = parseXhtml(xhtml('<p>line1<br/>line2</p>'));

      const p = nodes[0] as BlockNode;
      const texts = p.children.filter((c): c is TextNode => c.type === 'text');
      expect(texts.map((t) => t.content)).toContain('\n');
    });
  });

  describe('ignored elements', () => {
    it('parses <img> as an image node', () => {
      const { nodes, warnings } = parseXhtml(xhtml('<p>text<img src="x.png" alt="test"/>more</p>'));

      const p = nodes[0] as BlockNode;
      const imageNode = p.children.find((c) => c.type === 'image');
      expect(imageNode).toBeDefined();
      if (imageNode?.type === 'image') {
        expect(imageNode.src).toBe('x.png');
        expect(imageNode.alt).toBe('test');
      }
      expect(warnings).toHaveLength(0);
    });

    it('skips <script> and <style>', () => {
      const { warnings } = parseXhtml(
        xhtml('<p>text</p><script>alert("x")</script><style>.x{}</style>'),
      );
      expect(warnings).toHaveLength(2);
    });

    it('resolves SVG image hrefs through an alternate namespace prefix', () => {
      const { nodes } = parseXhtml(
        xhtml(
          '<svg xmlns:media="http://www.w3.org/1999/xlink"><image media:href="cover.png"/></svg>',
        ),
      );

      expect(nodes[0]).toMatchObject({ type: 'image', src: 'cover.png' });
    });

    it('falls back from an empty namespaced SVG href to a plain href', () => {
      const { nodes } = parseXhtml(
        xhtml(
          '<svg xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="" href="fallback.png"/></svg>',
        ),
      );

      expect(nodes[0]).toMatchObject({ type: 'image', src: 'fallback.png' });
    });
  });

  describe('attribute extraction', () => {
    it('extracts style attribute from a block element', () => {
      const { nodes } = parseXhtml(xhtml('<p style="color: red">Text</p>'));
      const p = nodes[0] as BlockNode;
      expect(p.attributes?.style).toBe('color: red');
    });

    it('extracts class attribute from an inline element', () => {
      const { nodes } = parseXhtml(xhtml('<p><span class="highlight">Text</span></p>'));
      const p = nodes[0] as BlockNode;
      const span = p.children[0] as InlineNode;
      expect(span.attributes?.class).toBe('highlight');
    });

    it('extracts id attribute', () => {
      const { nodes } = parseXhtml(xhtml('<div id="chapter1"><p>Text</p></div>'));
      const div = nodes[0] as BlockNode;
      expect(div.attributes?.id).toBe('chapter1');
    });

    it('extracts language attributes', () => {
      const { nodes } = parseXhtml(xhtml('<p lang="ja">本文</p>'));
      const p = nodes[0] as BlockNode;
      expect(p.attributes?.language).toBe('ja');
    });

    it('extracts xml:lang attributes', () => {
      const { nodes } = parseXhtml(xhtml('<p xml:lang="zh-Hant">正文</p>'));
      const p = nodes[0] as BlockNode;
      expect(p.attributes?.language).toBe('zh-Hant');
    });

    it('extracts multiple attributes simultaneously', () => {
      const { nodes } = parseXhtml(
        xhtml('<p id="intro" class="first" style="font-size: 18px">Text</p>'),
      );
      const p = nodes[0] as BlockNode;
      expect(p.attributes?.id).toBe('intro');
      expect(p.attributes?.class).toBe('first');
      expect(p.attributes?.style).toBe('font-size: 18px');
    });

    it('omits attributes when element has none', () => {
      const { nodes } = parseXhtml(xhtml('<p>Plain</p>'));
      const p = nodes[0] as BlockNode;
      expect(p.attributes).toBeUndefined();
    });

    it('preserves qualified namespace declarations and empty attributes', () => {
      const { nodes } = parseXhtml(
        xhtml('<p xmlns:ops="urn:example" ops:type="note" data-empty="">Text</p>'),
      );
      const attributes = (nodes[0] as BlockNode).attributes?.allAttributes;

      expect(attributes?.get('xmlns:ops')).toBe('urn:example');
      expect(attributes?.get('ops:type')).toBe('note');
      expect(attributes?.get('data-empty')).toBe('');
    });
  });

  describe('error handling', () => {
    it('throws XhtmlParseError on malformed XHTML', () => {
      expect(() => parseXhtml('<not-valid-xml<>')).toThrow(XhtmlParseError);
    });
  });
});
