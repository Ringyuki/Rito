import { describe, expect, it } from 'vitest';
import { parseCssDeclarations } from '../../src/style/css-property-parser';

const BASE_FONT_SIZE = 16;

describe('parseCssDeclarations', () => {
  describe('color', () => {
    it('parses color value as-is', () => {
      expect(parseCssDeclarations('color: red', BASE_FONT_SIZE)).toEqual({ color: 'red' });
    });

    it('parses hex color', () => {
      expect(parseCssDeclarations('color: #ff0000', BASE_FONT_SIZE)).toEqual({
        color: '#ff0000',
      });
    });
  });

  describe('font-size', () => {
    it('parses px value', () => {
      expect(parseCssDeclarations('font-size: 18px', BASE_FONT_SIZE)).toEqual({ fontSize: 18 });
    });

    it('parses pt value (1pt = 4/3 px)', () => {
      const result = parseCssDeclarations('font-size: 12pt', BASE_FONT_SIZE);
      expect(result.fontSize).toBeCloseTo(16);
    });

    it('parses em value relative to parent', () => {
      expect(parseCssDeclarations('font-size: 1.5em', BASE_FONT_SIZE)).toEqual({ fontSize: 24 });
    });
  });

  describe('font-family', () => {
    it('parses font family as-is', () => {
      expect(parseCssDeclarations('font-family: "Georgia", serif', BASE_FONT_SIZE)).toEqual({
        fontFamily: '"Georgia", serif',
      });
    });
  });

  describe('font-weight', () => {
    it('parses bold keyword', () => {
      expect(parseCssDeclarations('font-weight: bold', BASE_FONT_SIZE)).toEqual({
        fontWeight: 'bold',
      });
    });

    it('parses normal keyword', () => {
      expect(parseCssDeclarations('font-weight: normal', BASE_FONT_SIZE)).toEqual({
        fontWeight: 'normal',
      });
    });

    it('parses numeric weight 700 as bold', () => {
      expect(parseCssDeclarations('font-weight: 700', BASE_FONT_SIZE)).toEqual({
        fontWeight: 'bold',
      });
    });

    it('parses numeric weight 400 as normal', () => {
      expect(parseCssDeclarations('font-weight: 400', BASE_FONT_SIZE)).toEqual({
        fontWeight: 'normal',
      });
    });
  });

  describe('font-style', () => {
    it('parses italic', () => {
      expect(parseCssDeclarations('font-style: italic', BASE_FONT_SIZE)).toEqual({
        fontStyle: 'italic',
      });
    });

    it('parses oblique as italic', () => {
      expect(parseCssDeclarations('font-style: oblique', BASE_FONT_SIZE)).toEqual({
        fontStyle: 'italic',
      });
    });
  });

  describe('line-height', () => {
    it('parses unitless value', () => {
      expect(parseCssDeclarations('line-height: 1.8', BASE_FONT_SIZE)).toEqual({
        lineHeight: 1.8,
      });
    });

    it('parses px value as ratio to parent font size', () => {
      expect(parseCssDeclarations('line-height: 24px', BASE_FONT_SIZE)).toEqual({
        lineHeight: 1.5,
      });
    });
  });

  describe('text-align', () => {
    it('parses center', () => {
      expect(parseCssDeclarations('text-align: center', BASE_FONT_SIZE)).toEqual({
        textAlign: 'center',
      });
    });

    it('parses justify', () => {
      expect(parseCssDeclarations('text-align: justify', BASE_FONT_SIZE)).toEqual({
        textAlign: 'justify',
      });
    });
  });

  describe('text-decoration', () => {
    it('parses underline', () => {
      expect(parseCssDeclarations('text-decoration: underline', BASE_FONT_SIZE)).toEqual({
        textDecoration: 'underline',
      });
    });

    it('parses line-through', () => {
      expect(parseCssDeclarations('text-decoration: line-through', BASE_FONT_SIZE)).toEqual({
        textDecoration: 'line-through',
      });
    });
  });

  describe('text-indent', () => {
    it('parses px value', () => {
      expect(parseCssDeclarations('text-indent: 24px', BASE_FONT_SIZE)).toEqual({
        textIndent: 24,
      });
    });

    it('parses em value', () => {
      expect(parseCssDeclarations('text-indent: 2em', BASE_FONT_SIZE)).toEqual({
        textIndent: 32,
      });
    });
  });

  describe('margins', () => {
    it('parses margin-top', () => {
      expect(parseCssDeclarations('margin-top: 10px', BASE_FONT_SIZE)).toEqual({
        marginTop: 10,
      });
    });

    it('parses margin-bottom in em', () => {
      expect(parseCssDeclarations('margin-bottom: 2em', BASE_FONT_SIZE)).toEqual({
        marginBottom: 32,
      });
    });
  });

  describe('multiple declarations', () => {
    it('parses multiple properties', () => {
      const result = parseCssDeclarations('color: red; font-size: 18px', BASE_FONT_SIZE);
      expect(result).toEqual({ color: 'red', fontSize: 18 });
    });

    it('handles trailing semicolons', () => {
      const result = parseCssDeclarations('color: blue;', BASE_FONT_SIZE);
      expect(result).toEqual({ color: 'blue' });
    });
  });

  describe('edge cases', () => {
    it('returns empty object for empty string', () => {
      expect(parseCssDeclarations('', BASE_FONT_SIZE)).toEqual({});
    });

    it('ignores unknown properties', () => {
      expect(parseCssDeclarations('display: flex; z-index: 10', BASE_FONT_SIZE)).toEqual({});
    });

    it('ignores malformed declarations', () => {
      expect(parseCssDeclarations('not-valid', BASE_FONT_SIZE)).toEqual({});
    });

    it('handles extra whitespace', () => {
      const result = parseCssDeclarations('  color :  red  ;  font-size : 18px  ', BASE_FONT_SIZE);
      expect(result).toEqual({ color: 'red', fontSize: 18 });
    });
  });
});
