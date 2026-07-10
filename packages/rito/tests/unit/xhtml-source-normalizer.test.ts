import { describe, expect, it } from 'vitest';
import { XhtmlParseError } from '../../src/parser/xhtml/errors';
import {
  estimateNormalizedXhtmlSourceLength,
  isXhtmlSourceWithinNormalizationBudget,
  normalizeXhtmlSource,
} from '../../src/parser/xhtml/xhtml-source-normalizer';
import { parseXhtml } from '../../src/parser/xhtml/xhtml-parser';

describe('normalizeXhtmlSource', () => {
  describe('legacy HTML void elements', () => {
    it('self-closes an unpaired br element and parses it as a newline', () => {
      const source = '<p>first<br>second</p>';
      const normalized = '<p>first<br/>second</p>';

      expect(normalizeXhtmlSource(source)).toBe(normalized);
      expect(estimateNormalizedXhtmlSourceLength(source)).toBe(normalized.length);
      expect(isXhtmlSourceWithinNormalizationBudget(source, source.length)).toBe(false);
      expect(isXhtmlSourceWithinNormalizationBudget(source, normalized.length)).toBe(true);

      const parsed = parseXhtml(
        '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>first<br>second</p></body></html>',
      );
      expect(parsed.nodes).toMatchObject([
        {
          type: 'block',
          tag: 'p',
          children: [
            { type: 'text', content: 'first' },
            { type: 'text', content: '\n' },
            { type: 'text', content: 'second' },
          ],
        },
      ]);
    });

    it('preserves attributes and quoted greater-than signs', () => {
      expect(normalizeXhtmlSource('<p><br class="break" data-label="> next"></p>')).toBe(
        '<p><br class="break" data-label="> next"/></p>',
      );
    });

    it('normalizes other standard HTML void elements', () => {
      expect(
        normalizeXhtmlSource('<head><meta charset="utf-8"></head><body><hr><img src="x"></body>'),
      ).toBe('<head><meta charset="utf-8"/></head><body><hr/><img src="x"/></body>');
    });

    it('does not alter existing self-closing or explicitly closed elements', () => {
      const source = '<p>one<br/>two<br />three<br></br></p>';
      expect(normalizeXhtmlSource(source)).toBe(source);
    });

    it('leaves mismatched non-void elements for strict XML parsing to reject', () => {
      const source = '<html><body><p><strong>text</p></body></html>';
      expect(normalizeXhtmlSource(source)).toBe(source);
      expect(() => parseXhtml(source)).toThrow(XhtmlParseError);
    });
  });

  describe('protected source contexts', () => {
    it('does not alter comments, CDATA, processing instructions, or declarations', () => {
      const source = [
        '<!DOCTYPE html [<!ENTITY sample "<br>">]>',
        '<?sample <br>?>',
        '<!-- <br> -->',
        '<![CDATA[<br>]]>',
        '<p>actual<br>break</p>',
      ].join('');

      expect(normalizeXhtmlSource(source)).toBe(
        source.replace('<p>actual<br>break</p>', '<p>actual<br/>break</p>'),
      );
    });

    it('does not alter markup-like text inside attribute values', () => {
      const source = '<p title="example: <br>" data-other="<img>">text</p>';
      expect(normalizeXhtmlSource(source)).toBe(source);
    });

    it('does not alter script or style contents', () => {
      const source =
        '<script>const sample = "<br>";</script><style>x::after { content: "<br>"; }</style><p><br></p>';
      expect(normalizeXhtmlSource(source)).toBe(
        '<script>const sample = "<br>";</script><style>x::after { content: "<br>"; }</style><p><br/></p>',
      );
    });

    it('leaves escaped markup in text unchanged', () => {
      const source = '<p>Write &lt;br&gt; to describe a break.</p>';
      expect(normalizeXhtmlSource(source)).toBe(source);
    });
  });
});
