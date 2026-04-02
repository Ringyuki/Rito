// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parseXhtml } from '../../src/parser/xhtml/xhtml-parser';
import { XhtmlParseError } from '../../src/parser/xhtml/errors';
import type { BlockNode, InlineNode, TextNode } from '../../src/parser/xhtml/types';

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
    it('skips <img> and produces a warning', () => {
      const { nodes, warnings } = parseXhtml(xhtml('<p>text<img src="x.png"/>more</p>'));

      const p = nodes[0] as BlockNode;
      const texts = p.children.filter((c): c is TextNode => c.type === 'text');
      expect(texts.map((t) => t.content.trim())).toEqual(expect.arrayContaining(['text', 'more']));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('<img>');
    });

    it('skips <script> and <style>', () => {
      const { warnings } = parseXhtml(
        xhtml('<p>text</p><script>alert("x")</script><style>.x{}</style>'),
      );
      expect(warnings).toHaveLength(2);
    });
  });

  describe('error handling', () => {
    it('throws XhtmlParseError on malformed XHTML', () => {
      expect(() => parseXhtml('<not-valid-xml<>')).toThrow(XhtmlParseError);
    });
  });
});
