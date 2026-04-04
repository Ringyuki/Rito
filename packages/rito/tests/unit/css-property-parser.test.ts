import { describe, expect, it } from 'vitest';
import { parseCssDeclarations } from '../../src/style/css/property-parser';

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
    it('parses bold keyword to 700', () => {
      expect(parseCssDeclarations('font-weight: bold', BASE_FONT_SIZE)).toEqual({
        fontWeight: 700,
      });
    });

    it('parses normal keyword to 400', () => {
      expect(parseCssDeclarations('font-weight: normal', BASE_FONT_SIZE)).toEqual({
        fontWeight: 400,
      });
    });

    it('parses numeric weight 700', () => {
      expect(parseCssDeclarations('font-weight: 700', BASE_FONT_SIZE)).toEqual({
        fontWeight: 700,
      });
    });

    it('parses numeric weight 400', () => {
      expect(parseCssDeclarations('font-weight: 400', BASE_FONT_SIZE)).toEqual({
        fontWeight: 400,
      });
    });

    it('parses numeric weight 300', () => {
      expect(parseCssDeclarations('font-weight: 300', BASE_FONT_SIZE)).toEqual({
        fontWeight: 300,
      });
    });

    it('parses numeric weight 900', () => {
      expect(parseCssDeclarations('font-weight: 900', BASE_FONT_SIZE)).toEqual({
        fontWeight: 900,
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

  describe('rem units', () => {
    it('parses font-size in rem with default root (16)', () => {
      expect(parseCssDeclarations('font-size: 1.5rem', BASE_FONT_SIZE)).toEqual({
        fontSize: 24,
      });
    });

    it('parses font-size in rem with custom root', () => {
      expect(parseCssDeclarations('font-size: 2rem', BASE_FONT_SIZE, 20)).toEqual({
        fontSize: 40,
      });
    });

    it('parses margin in rem', () => {
      expect(parseCssDeclarations('margin-top: 1rem', BASE_FONT_SIZE, 20)).toEqual({
        marginTop: 20,
      });
    });

    it('parses padding in rem', () => {
      expect(parseCssDeclarations('padding-left: 0.5rem', BASE_FONT_SIZE)).toEqual({
        paddingLeft: 8,
      });
    });

    it('parses text-indent in rem', () => {
      expect(parseCssDeclarations('text-indent: 2rem', BASE_FONT_SIZE, 10)).toEqual({
        textIndent: 20,
      });
    });

    it('parses width in rem', () => {
      expect(parseCssDeclarations('width: 20rem', BASE_FONT_SIZE)).toEqual({
        width: 320,
      });
    });

    it('parses letter-spacing in rem', () => {
      expect(parseCssDeclarations('letter-spacing: 0.1rem', BASE_FONT_SIZE)).toEqual({
        letterSpacing: 1.6,
      });
    });
  });

  describe('calc() expressions', () => {
    it('parses calc(1em + 10px) in font-size', () => {
      // 1em = 16px, so 16 + 10 = 26
      expect(parseCssDeclarations('font-size: calc(1em + 10px)', BASE_FONT_SIZE)).toEqual({
        fontSize: 26,
      });
    });

    it('parses calc with rem in margin', () => {
      // 2rem = 40px (root=20), minus 10px = 30
      expect(parseCssDeclarations('margin-top: calc(2rem - 10px)', BASE_FONT_SIZE, 20)).toEqual({
        marginTop: 30,
      });
    });

    it('parses calc in padding shorthand', () => {
      expect(parseCssDeclarations('padding-top: calc(10px + 10px)', BASE_FONT_SIZE)).toEqual({
        paddingTop: 20,
      });
    });

    it('parses calc with multiplication', () => {
      expect(parseCssDeclarations('width: calc(10px * 5)', BASE_FONT_SIZE)).toEqual({
        width: 50,
      });
    });

    it('parses calc mixing em and rem', () => {
      // 1em = 16px, 1rem = 20px, sum = 36
      expect(parseCssDeclarations('margin-left: calc(1em + 1rem)', BASE_FONT_SIZE, 20)).toEqual({
        marginLeft: 36,
        marginLeftAuto: false,
      });
    });
  });

  describe('margin:auto', () => {
    it('parses margin-left: auto', () => {
      const result = parseCssDeclarations('margin-left: auto', BASE_FONT_SIZE);
      expect(result.marginLeft).toBe(0);
      expect(result.marginLeftAuto).toBe(true);
    });

    it('parses margin-right: auto', () => {
      const result = parseCssDeclarations('margin-right: auto', BASE_FONT_SIZE);
      expect(result.marginRight).toBe(0);
      expect(result.marginRightAuto).toBe(true);
    });

    it('parses margin-left with explicit value and resets auto flag', () => {
      const result = parseCssDeclarations('margin-left: 20px', BASE_FONT_SIZE);
      expect(result.marginLeft).toBe(20);
      expect(result.marginLeftAuto).toBe(false);
    });

    it('parses margin-right with explicit value and resets auto flag', () => {
      const result = parseCssDeclarations('margin-right: 30px', BASE_FONT_SIZE);
      expect(result.marginRight).toBe(30);
      expect(result.marginRightAuto).toBe(false);
    });

    it('parses margin shorthand "0 auto" for centering', () => {
      const result = parseCssDeclarations('margin: 0 auto', BASE_FONT_SIZE);
      expect(result.marginTop).toBe(0);
      expect(result.marginBottom).toBe(0);
      expect(result.marginLeft).toBe(0);
      expect(result.marginRight).toBe(0);
      expect(result.marginLeftAuto).toBe(true);
      expect(result.marginRightAuto).toBe(true);
    });

    it('parses margin shorthand "10px auto"', () => {
      const result = parseCssDeclarations('margin: 10px auto', BASE_FONT_SIZE);
      expect(result.marginTop).toBe(10);
      expect(result.marginBottom).toBe(10);
      expect(result.marginLeftAuto).toBe(true);
      expect(result.marginRightAuto).toBe(true);
    });

    it('parses margin shorthand "10px auto 20px"', () => {
      const result = parseCssDeclarations('margin: 10px auto 20px', BASE_FONT_SIZE);
      expect(result.marginTop).toBe(10);
      expect(result.marginBottom).toBe(20);
      expect(result.marginLeftAuto).toBe(true);
      expect(result.marginRightAuto).toBe(true);
    });

    it('parses margin shorthand "10px 20px 30px auto"', () => {
      const result = parseCssDeclarations('margin: 10px 20px 30px auto', BASE_FONT_SIZE);
      expect(result.marginTop).toBe(10);
      expect(result.marginRight).toBe(20);
      expect(result.marginRightAuto).toBe(false);
      expect(result.marginBottom).toBe(30);
      expect(result.marginLeft).toBe(0);
      expect(result.marginLeftAuto).toBe(true);
    });

    it('parses margin shorthand "auto" (all sides auto)', () => {
      const result = parseCssDeclarations('margin: auto', BASE_FONT_SIZE);
      expect(result.marginTop).toBe(0);
      expect(result.marginBottom).toBe(0);
      expect(result.marginLeftAuto).toBe(true);
      expect(result.marginRightAuto).toBe(true);
    });

    it('does not set auto flags for margin-top auto', () => {
      // margin-top: auto is treated as 0, no auto flag
      const result = parseCssDeclarations('margin: auto 10px', BASE_FONT_SIZE);
      expect(result.marginTop).toBe(0);
      expect(result.marginBottom).toBe(0);
      expect(result.marginLeft).toBe(10);
      expect(result.marginRight).toBe(10);
      expect(result.marginLeftAuto).toBe(false);
      expect(result.marginRightAuto).toBe(false);
    });
  });

  describe('min-height', () => {
    it('parses min-height in px', () => {
      const result = parseCssDeclarations('min-height: 50px', BASE_FONT_SIZE);
      expect(result.minHeight).toBe(50);
    });

    it('parses min-height in em', () => {
      const result = parseCssDeclarations('min-height: 2em', BASE_FONT_SIZE);
      expect(result.minHeight).toBe(32);
    });

    it('ignores zero min-height', () => {
      const result = parseCssDeclarations('min-height: 0px', BASE_FONT_SIZE);
      expect(result.minHeight).toBeUndefined();
    });

    it('ignores negative min-height', () => {
      const result = parseCssDeclarations('min-height: -10px', BASE_FONT_SIZE);
      expect(result.minHeight).toBeUndefined();
    });
  });

  describe('max-height', () => {
    it('parses max-height in px', () => {
      const result = parseCssDeclarations('max-height: 100px', BASE_FONT_SIZE);
      expect(result.maxHeight).toBe(100);
    });

    it('parses max-height in em', () => {
      const result = parseCssDeclarations('max-height: 3em', BASE_FONT_SIZE);
      expect(result.maxHeight).toBe(48);
    });

    it('ignores zero max-height', () => {
      const result = parseCssDeclarations('max-height: 0', BASE_FONT_SIZE);
      expect(result.maxHeight).toBeUndefined();
    });
  });

  describe('overflow', () => {
    it('parses overflow: hidden', () => {
      const result = parseCssDeclarations('overflow: hidden', BASE_FONT_SIZE);
      expect(result.overflow).toBe('hidden');
    });

    it('parses overflow: visible', () => {
      const result = parseCssDeclarations('overflow: visible', BASE_FONT_SIZE);
      expect(result.overflow).toBe('visible');
    });

    it('ignores unsupported overflow values', () => {
      const result = parseCssDeclarations('overflow: scroll', BASE_FONT_SIZE);
      expect(result.overflow).toBeUndefined();
    });
  });

  describe('box-sizing', () => {
    it('parses box-sizing: border-box', () => {
      const result = parseCssDeclarations('box-sizing: border-box', BASE_FONT_SIZE);
      expect(result.boxSizing).toBe('border-box');
    });

    it('parses box-sizing: content-box', () => {
      const result = parseCssDeclarations('box-sizing: content-box', BASE_FONT_SIZE);
      expect(result.boxSizing).toBe('content-box');
    });

    it('ignores invalid box-sizing values', () => {
      const result = parseCssDeclarations('box-sizing: padding-box', BASE_FONT_SIZE);
      expect(result.boxSizing).toBeUndefined();
    });

    it('parses box-sizing with other declarations', () => {
      const result = parseCssDeclarations(
        'width: 200px; box-sizing: border-box; padding: 10px',
        BASE_FONT_SIZE,
      );
      expect(result.boxSizing).toBe('border-box');
      expect(result.width).toBe(200);
      expect(result.paddingLeft).toBe(10);
      expect(result.paddingRight).toBe(10);
    });
  });

  describe('border-radius', () => {
    it('parses border-radius in px', () => {
      const result = parseCssDeclarations('border-radius: 8px', BASE_FONT_SIZE);
      expect(result.borderRadius).toBe(8);
    });

    it('parses border-radius in em', () => {
      const result = parseCssDeclarations('border-radius: 0.5em', BASE_FONT_SIZE);
      expect(result.borderRadius).toBe(8);
    });

    it('parses border-radius: 0', () => {
      const result = parseCssDeclarations('border-radius: 0', BASE_FONT_SIZE);
      expect(result.borderRadius).toBe(0);
    });

    it('ignores negative border-radius', () => {
      const result = parseCssDeclarations('border-radius: -5px', BASE_FONT_SIZE);
      expect(result.borderRadius).toBeUndefined();
    });

    it('parses border-radius in rem', () => {
      const result = parseCssDeclarations('border-radius: 1rem', BASE_FONT_SIZE, 20);
      expect(result.borderRadius).toBe(20);
    });
  });

  describe('opacity', () => {
    it('parses opacity: 1', () => {
      const result = parseCssDeclarations('opacity: 1', BASE_FONT_SIZE);
      expect(result.opacity).toBe(1);
    });

    it('parses opacity: 0', () => {
      const result = parseCssDeclarations('opacity: 0', BASE_FONT_SIZE);
      expect(result.opacity).toBe(0);
    });

    it('parses fractional opacity', () => {
      const result = parseCssDeclarations('opacity: 0.5', BASE_FONT_SIZE);
      expect(result.opacity).toBe(0.5);
    });

    it('clamps opacity above 1 to 1', () => {
      const result = parseCssDeclarations('opacity: 2', BASE_FONT_SIZE);
      expect(result.opacity).toBe(1);
    });

    it('clamps opacity below 0 to 0', () => {
      const result = parseCssDeclarations('opacity: -0.5', BASE_FONT_SIZE);
      expect(result.opacity).toBe(0);
    });

    it('ignores non-numeric opacity', () => {
      const result = parseCssDeclarations('opacity: inherit', BASE_FONT_SIZE);
      expect(result.opacity).toBeUndefined();
    });
  });
});
