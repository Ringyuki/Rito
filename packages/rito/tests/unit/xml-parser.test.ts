import { describe, expect, it } from 'vitest';
import {
  childElements,
  DEFAULT_XML_PARSE_LIMITS,
  findDescendants,
  findElements,
  findFirstDescendant,
  findFirstElement,
  getAttribute,
  getAttributeNS,
  hasAttribute,
  parseXml,
  textContent,
} from '../../src/parser/xml';
import type { XmlParseLimits } from '../../src/parser/xml';

const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';

class TestXmlParseError extends Error {
  override readonly name = 'TestXmlParseError';
}

function parse(source: string, limits: XmlParseLimits = DEFAULT_XML_PARSE_LIMITS) {
  return parseXml(
    source,
    (details) => new TestXmlParseError(`Invalid test XML: ${details}`),
    limits,
  );
}

function limits(overrides: Partial<XmlParseLimits>): XmlParseLimits {
  return { ...DEFAULT_XML_PARSE_LIMITS, ...overrides };
}

function nestedXml(depth: number): string {
  return `${'<node>'.repeat(depth)}${'</node>'.repeat(depth)}`;
}

describe('parser-private XML parser', () => {
  describe('basic tree and queries', () => {
    it('parses declarations, attributes, entities, and self-closing elements', () => {
      const document = parse(
        `<?xml version='1.0' encoding='UTF-8'?>
<root id="a&amp;b" empty="">
  <empty/>
  <group><item rank="1">one &lt; two &#x1F600;</item></group>
</root>`,
      );

      expect(document.root).toMatchObject({
        type: 'element',
        qualifiedName: 'root',
        localName: 'root',
        prefix: '',
        namespaceUri: '',
      });
      expect(getAttribute(document.root, 'id')).toBe('a&b');
      expect(hasAttribute(document.root, 'empty')).toBe(true);
      expect(getAttribute(document.root, 'empty')).toBe('');
      expect(hasAttribute(document.root, 'missing')).toBe(false);

      expect(childElements(document.root).map((element) => element.qualifiedName)).toEqual([
        'empty',
        'group',
      ]);
      expect(findElements(document.root, 'item')).toHaveLength(1);
      expect(findDescendants(document.root, 'item')).toHaveLength(1);
      expect(findFirstElement(document.root, 'root')).toBe(document.root);

      const item = findFirstDescendant(document.root, 'item');
      expect(item).toBeDefined();
      if (!item) throw new Error('Expected an item element');
      expect(getAttribute(item, 'rank')).toBe('1');
      expect(textContent(item)).toBe('one < two 😀');
    });

    it('normalizes XML line endings in text and attributes', () => {
      const document = parse('<root value="a\r\nb\rc">a\r\nb\rc</root>');

      expect(getAttribute(document.root, 'value')).toBe('a b c');
      expect(textContent(document.root)).toBe('a\nb\nc');
    });

    it('accepts an external public doctype without adding it to the tree', () => {
      const document = parse(
        '<!DOCTYPE root PUBLIC "-//EXAMPLE//DTD Root 1.0//EN" "https://example.invalid/root.dtd"><root/>',
      );

      expect(document.root.qualifiedName).toBe('root');
      expect(document.root.children).toEqual([]);
    });
  });

  describe('namespaces', () => {
    it('resolves default, prefixed, attribute, and implicit XML namespaces', () => {
      const document = parse(`
<root xmlns="urn:root" xmlns:p="urn:prefixed" plain="x" p:flag="yes" xml:lang="ja">
  <p:item><leaf/><p:leaf/></p:item>
</root>`);
      const root = document.root;

      expect(root.namespaceUri).toBe('urn:root');
      expect(root.localName).toBe('root');
      expect(getAttributeNS(root, '', 'plain')).toBe('x');
      expect(getAttributeNS(root, 'urn:prefixed', 'flag')).toBe('yes');
      expect(getAttributeNS(root, XML_NAMESPACE, 'lang')).toBe('ja');

      const item = findFirstDescendant(root, 'p:item');
      expect(item).toMatchObject({
        qualifiedName: 'p:item',
        prefix: 'p',
        localName: 'item',
        namespaceUri: 'urn:prefixed',
      });
      const leaves = item ? childElements(item) : [];
      expect(leaves[0]).toMatchObject({
        qualifiedName: 'leaf',
        namespaceUri: 'urn:root',
      });
      expect(leaves[1]).toMatchObject({
        qualifiedName: 'p:leaf',
        namespaceUri: 'urn:prefixed',
      });
    });

    it('scopes prefix rebinding to the declaring element', () => {
      const document = parse(`
<root xmlns:p="urn:outer">
  <p:item/>
  <group xmlns:p="urn:inner"><p:item/></group>
  <p:item/>
</root>`);
      const items = findElements(document.root, 'p:item');

      expect(items.map((item) => item.namespaceUri)).toEqual([
        'urn:outer',
        'urn:inner',
        'urn:outer',
      ]);
    });

    it('does not apply a default namespace to unprefixed attributes', () => {
      const root = parse('<root xmlns="urn:elements" value="plain"/>').root;

      expect(root.namespaceUri).toBe('urn:elements');
      expect(getAttributeNS(root, '', 'value')).toBe('plain');
      expect(getAttributeNS(root, 'urn:elements', 'value')).toBeUndefined();
    });
  });

  describe('text, CDATA, and ignored markup', () => {
    it('coalesces entity text while preserving ignored-markup text boundaries', () => {
      const root = parse(
        '<root>a&amp;b<!-- ignored -->c<?target ignored?>d<![CDATA[e<f&g]]>h<![CDATA[i]]><![CDATA[j]]>k</root>',
      ).root;

      expect(root.children).toEqual([
        { type: 'text', value: 'a&b' },
        { type: 'text', value: 'c' },
        { type: 'text', value: 'd' },
        { type: 'cdata', value: 'e<f&g' },
        { type: 'text', value: 'h' },
        { type: 'cdata', value: 'i' },
        { type: 'cdata', value: 'j' },
        { type: 'text', value: 'k' },
      ]);
      expect(textContent(root)).toBe('a&bcde<f&ghijk');
      const cdata = root.children[3];
      expect(cdata).toBeDefined();
      if (!cdata) throw new Error('Expected a CDATA node');
      expect(textContent(cdata)).toBe('e<f&g');
    });

    it('keeps comments out of child and descendant element queries', () => {
      const root = parse('<root><!-- <fake/> --><real/><!-- tail --></root>').root;

      expect(childElements(root).map((element) => element.qualifiedName)).toEqual(['real']);
      expect(findElements(root, 'fake')).toEqual([]);
    });
  });

  describe('malformed and unsafe XML', () => {
    it.each([
      ['mismatched tags', '<root><child></root>'],
      ['unclosed document element', '<root><child/></root'],
      ['multiple document elements', '<first/><second/>'],
      ['duplicate attributes', '<root value="one" value="two"/>'],
      ['undeclared namespace prefix', '<root><missing:item/></root>'],
      ['unknown entity', '<root>&notDeclared;</root>'],
      ['illegal XML character', '<root>bad\u0000value</root>'],
    ])('rejects %s', (_label, source) => {
      expect(() => parse(source)).toThrow(TestXmlParseError);
      expect(() => parse(source)).toThrow('Invalid test XML:');
    });

    it('does not expand entities declared in an internal DTD subset', () => {
      const source = '<!DOCTYPE root [<!ENTITY secret "expanded">]><root>&secret;</root>';

      expect(() => parse(source)).toThrow(TestXmlParseError);
      expect(() => parse(source)).toThrow(/entity/i);
    });

    it('does not resolve external system entities', () => {
      const source =
        '<!DOCTYPE root [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><root>&xxe;</root>';

      expect(() => parse(source)).toThrow(TestXmlParseError);
      expect(() => parse(source)).toThrow(/entity/i);
    });

    it('does not expand recursive entity declarations', () => {
      const source = `<!DOCTYPE root [
        <!ENTITY a "ha">
        <!ENTITY b "&a;&a;">
        <!ENTITY c "&b;&b;">
      ]><root>&c;</root>`;

      expect(() => parse(source)).toThrow(TestXmlParseError);
      expect(() => parse(source)).toThrow(/entity/i);
    });
  });

  describe('default resource limits', () => {
    it('accepts a document at the maximum XML depth', () => {
      expect(parse(nestedXml(256)).root.qualifiedName).toBe('node');
    });

    it('rejects a document one level beyond the maximum XML depth', () => {
      expect(() => parse(nestedXml(257))).toThrow(TestXmlParseError);
      expect(() => parse(nestedXml(257))).toThrow('maximum XML depth of 256 exceeded');
    });

    it('rejects excessive attributes on one element', () => {
      const attributes = Array.from({ length: 1_025 }, (_, index) => `a${String(index)}=""`).join(
        ' ',
      );

      expect(() => parse(`<root ${attributes}/>`)).toThrow(
        'maximum attributes per element of 1024 exceeded',
      );
    });

    it('limits retained tree nodes independently of parser events', () => {
      const source = '<root><first/><second/></root>';

      expect(() => parse(source, limits({ maxTreeNodes: 2 }))).toThrow(
        'maximum XML tree node count of 2 exceeded',
      );
    });

    it('counts ignored markup toward the parser event budget', () => {
      const source = '<root><!-- one --><?reader test?><!-- two --></root>';

      expect(() => parse(source, limits({ maxEvents: 3 }))).toThrow(
        'maximum XML event count of 3 exceeded',
      );
    });

    it('checks the total attribute budget while attributes stream in', () => {
      const source = '<root first=""><child second=""/></root>';

      expect(() => parse(source, limits({ maxTotalAttributes: 1 }))).toThrow(
        'maximum XML attribute count of 1 exceeded',
      );
    });

    it('checks the per-element attribute budget while attributes stream in', () => {
      const source = '<root first="" second=""/>';

      expect(() => parse(source, limits({ maxAttributesPerElement: 1 }))).toThrow(
        'maximum attributes per element of 1 exceeded',
      );
    });
  });
});
