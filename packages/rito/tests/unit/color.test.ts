import { describe, expect, it } from 'vitest';
import {
  parseColor,
  relativeLuminance,
  contrastRatio,
  resolveTextColor,
} from '../../src/utils/color';

describe('parseColor', () => {
  it('parses #rrggbb hex', () => {
    expect(parseColor('#ff0000')).toEqual([255, 0, 0]);
    expect(parseColor('#00ff00')).toEqual([0, 255, 0]);
    expect(parseColor('#0000ff')).toEqual([0, 0, 255]);
    expect(parseColor('#000000')).toEqual([0, 0, 0]);
    expect(parseColor('#ffffff')).toEqual([255, 255, 255]);
  });

  it('parses #rgb shorthand', () => {
    expect(parseColor('#f00')).toEqual([255, 0, 0]);
    expect(parseColor('#0f0')).toEqual([0, 255, 0]);
    expect(parseColor('#00f')).toEqual([0, 0, 255]);
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor('#000')).toEqual([0, 0, 0]);
  });

  it('parses named colors', () => {
    expect(parseColor('black')).toEqual([0, 0, 0]);
    expect(parseColor('white')).toEqual([255, 255, 255]);
    expect(parseColor('red')).toEqual([255, 0, 0]);
    expect(parseColor('green')).toEqual([0, 128, 0]);
    expect(parseColor('blue')).toEqual([0, 0, 255]);
    expect(parseColor('gray')).toEqual([128, 128, 128]);
    expect(parseColor('grey')).toEqual([128, 128, 128]);
  });

  it('parses additional CSS named colors', () => {
    expect(parseColor('tomato')).toEqual([255, 99, 71]);
    expect(parseColor('cornflowerblue')).toEqual([100, 149, 237]);
    expect(parseColor('rebeccapurple')).toEqual([102, 51, 153]);
    expect(parseColor('magenta')).toEqual([255, 0, 255]);
    expect(parseColor('cyan')).toEqual([0, 255, 255]);
    expect(parseColor('coral')).toEqual([255, 127, 80]);
    expect(parseColor('gold')).toEqual([255, 215, 0]);
    expect(parseColor('indigo')).toEqual([75, 0, 130]);
    expect(parseColor('salmon')).toEqual([250, 128, 114]);
    expect(parseColor('teal')).toEqual([0, 128, 128]);
    expect(parseColor('navy')).toEqual([0, 0, 128]);
    expect(parseColor('olive')).toEqual([128, 128, 0]);
    expect(parseColor('silver')).toEqual([192, 192, 192]);
    expect(parseColor('maroon')).toEqual([128, 0, 0]);
    expect(parseColor('lime')).toEqual([0, 255, 0]);
    expect(parseColor('aqua')).toEqual([0, 255, 255]);
    expect(parseColor('fuchsia')).toEqual([255, 0, 255]);
  });

  it('is case insensitive for named colors', () => {
    expect(parseColor('BLACK')).toEqual([0, 0, 0]);
    expect(parseColor('White')).toEqual([255, 255, 255]);
    expect(parseColor('RED')).toEqual([255, 0, 0]);
    expect(parseColor('Tomato')).toEqual([255, 99, 71]);
    expect(parseColor('CornflowerBlue')).toEqual([100, 149, 237]);
  });

  it('trims whitespace', () => {
    expect(parseColor('  #ff0000  ')).toEqual([255, 0, 0]);
    expect(parseColor(' black ')).toEqual([0, 0, 0]);
  });

  it('returns undefined for invalid hex', () => {
    expect(parseColor('#gg0000')).toBeUndefined();
    expect(parseColor('#12345')).toBeUndefined();
    expect(parseColor('#1234')).toBeUndefined();
    expect(parseColor('#12345678')).toBeUndefined();
    expect(parseColor('#')).toBeUndefined();
  });

  it('returns undefined for unknown named colors', () => {
    expect(parseColor('nonsense')).toBeUndefined();
    expect(parseColor('notacolor')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(parseColor('')).toBeUndefined();
  });

  // rgb() / rgba() parsing
  describe('rgb()/rgba()', () => {
    it('parses comma-separated rgb()', () => {
      expect(parseColor('rgb(255, 0, 0)')).toEqual([255, 0, 0]);
      expect(parseColor('rgb(0, 128, 255)')).toEqual([0, 128, 255]);
      expect(parseColor('rgb(0, 0, 0)')).toEqual([0, 0, 0]);
      expect(parseColor('rgb(255, 255, 255)')).toEqual([255, 255, 255]);
    });

    it('parses space-separated rgb()', () => {
      expect(parseColor('rgb(255 0 0)')).toEqual([255, 0, 0]);
      expect(parseColor('rgb(0 128 255)')).toEqual([0, 128, 255]);
    });

    it('parses comma-separated rgba() (ignores alpha)', () => {
      expect(parseColor('rgba(255, 0, 0, 1)')).toEqual([255, 0, 0]);
      expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual([0, 0, 0]);
      expect(parseColor('rgba(128, 64, 32, 0)')).toEqual([128, 64, 32]);
    });

    it('parses space-separated rgba() with slash alpha', () => {
      expect(parseColor('rgba(255 0 0 / 0.5)')).toEqual([255, 0, 0]);
      expect(parseColor('rgb(0 128 255 / 1)')).toEqual([0, 128, 255]);
    });

    it('rounds fractional rgb values', () => {
      expect(parseColor('rgb(127.5, 63.7, 200.2)')).toEqual([128, 64, 200]);
    });

    it('is case insensitive for rgb/rgba', () => {
      expect(parseColor('RGB(255, 0, 0)')).toEqual([255, 0, 0]);
      expect(parseColor('RGBA(0, 0, 0, 1)')).toEqual([0, 0, 0]);
    });

    it('returns undefined for out-of-range values', () => {
      expect(parseColor('rgb(256, 0, 0)')).toBeUndefined();
      expect(parseColor('rgb(-1, 0, 0)')).toBeUndefined();
      expect(parseColor('rgb(0, 0, 300)')).toBeUndefined();
    });

    it('returns undefined for too few arguments', () => {
      expect(parseColor('rgb(255, 0)')).toBeUndefined();
      expect(parseColor('rgb(255)')).toBeUndefined();
      expect(parseColor('rgb()')).toBeUndefined();
    });

    it('returns undefined for non-numeric arguments', () => {
      expect(parseColor('rgb(foo, bar, baz)')).toBeUndefined();
    });
  });

  // hsl() / hsla() parsing
  describe('hsl()/hsla()', () => {
    it('parses comma-separated hsl()', () => {
      // Pure red: hsl(0, 100%, 50%)
      expect(parseColor('hsl(0, 100, 50)')).toEqual([255, 0, 0]);
      // Pure green: hsl(120, 100%, 50%)
      expect(parseColor('hsl(120, 100, 50)')).toEqual([0, 255, 0]);
      // Pure blue: hsl(240, 100%, 50%)
      expect(parseColor('hsl(240, 100, 50)')).toEqual([0, 0, 255]);
    });

    it('parses space-separated hsl()', () => {
      expect(parseColor('hsl(0 100 50)')).toEqual([255, 0, 0]);
      expect(parseColor('hsl(120 100 50)')).toEqual([0, 255, 0]);
    });

    it('parses hsla() with comma-separated values (ignores alpha)', () => {
      expect(parseColor('hsla(0, 100, 50, 1)')).toEqual([255, 0, 0]);
      expect(parseColor('hsla(120, 100, 50, 0.5)')).toEqual([0, 255, 0]);
    });

    it('parses hsla() with space-separated values and slash alpha', () => {
      expect(parseColor('hsla(0 100 50 / 0.5)')).toEqual([255, 0, 0]);
    });

    it('converts black and white correctly', () => {
      // Black: hsl(0, 0%, 0%)
      expect(parseColor('hsl(0, 0, 0)')).toEqual([0, 0, 0]);
      // White: hsl(0, 0%, 100%)
      expect(parseColor('hsl(0, 0, 100)')).toEqual([255, 255, 255]);
    });

    it('converts gray correctly', () => {
      // 50% gray
      const result = parseColor('hsl(0, 0, 50)');
      expect(result).toEqual([128, 128, 128]);
    });

    it('handles negative and large hue values via modulo', () => {
      // 360 wraps to 0 -> red
      expect(parseColor('hsl(360, 100, 50)')).toEqual([255, 0, 0]);
      // -120 wraps to 240 -> blue
      expect(parseColor('hsl(-120, 100, 50)')).toEqual([0, 0, 255]);
    });

    it('is case insensitive for hsl/hsla', () => {
      expect(parseColor('HSL(0, 100, 50)')).toEqual([255, 0, 0]);
      expect(parseColor('HSLA(120, 100, 50, 1)')).toEqual([0, 255, 0]);
    });

    it('returns undefined for too few arguments', () => {
      expect(parseColor('hsl(0, 100)')).toBeUndefined();
      expect(parseColor('hsl(0)')).toBeUndefined();
      expect(parseColor('hsl()')).toBeUndefined();
    });

    it('returns undefined for non-numeric arguments', () => {
      expect(parseColor('hsl(foo, bar, baz)')).toBeUndefined();
    });
  });
});

describe('relativeLuminance', () => {
  it('returns 0 for black', () => {
    expect(relativeLuminance(0, 0, 0)).toBe(0);
  });

  it('returns 1 for white', () => {
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 4);
  });

  it('computes correct luminance for pure red', () => {
    const lum = relativeLuminance(255, 0, 0);
    expect(lum).toBeCloseTo(0.2126, 3);
  });

  it('computes correct luminance for pure green', () => {
    const lum = relativeLuminance(0, 255, 0);
    expect(lum).toBeCloseTo(0.7152, 3);
  });

  it('computes correct luminance for pure blue', () => {
    const lum = relativeLuminance(0, 0, 255);
    expect(lum).toBeCloseTo(0.0722, 3);
  });

  it('gray has intermediate luminance', () => {
    const lum = relativeLuminance(128, 128, 128);
    expect(lum).toBeGreaterThan(0);
    expect(lum).toBeLessThan(1);
  });

  it('luminance increases with brightness', () => {
    const dark = relativeLuminance(50, 50, 50);
    const mid = relativeLuminance(128, 128, 128);
    const light = relativeLuminance(200, 200, 200);
    expect(dark).toBeLessThan(mid);
    expect(mid).toBeLessThan(light);
  });
});

describe('contrastRatio', () => {
  it('returns 21:1 for black vs white', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 0);
  });

  it('returns 1:1 for same color', () => {
    expect(contrastRatio([128, 128, 128], [128, 128, 128])).toBeCloseTo(1, 4);
  });

  it('is symmetric (order independent)', () => {
    const ab = contrastRatio([255, 0, 0], [0, 0, 255]);
    const ba = contrastRatio([0, 0, 255], [255, 0, 0]);
    expect(ab).toBeCloseTo(ba, 4);
  });

  it('is always >= 1', () => {
    expect(contrastRatio([100, 100, 100], [101, 101, 101])).toBeGreaterThanOrEqual(1);
  });

  it('white on black equals black on white', () => {
    const wb = contrastRatio([255, 255, 255], [0, 0, 0]);
    const bw = contrastRatio([0, 0, 0], [255, 255, 255]);
    expect(wb).toBeCloseTo(bw, 4);
  });
});

describe('resolveTextColor', () => {
  it('keeps original when contrast is sufficient', () => {
    // black text on white bg — high contrast
    expect(resolveTextColor('#000000', '#ffffff', '#111111')).toBe('#000000');
  });

  it('returns override when contrast is insufficient', () => {
    // white text on white bg — no contrast
    expect(resolveTextColor('#ffffff', '#ffffff', '#000000')).toBe('#000000');
  });

  it('returns original when fg is unparseable', () => {
    expect(resolveTextColor('notacolor', '#ffffff', '#000000')).toBe('notacolor');
  });

  it('returns original when bg is unparseable', () => {
    expect(resolveTextColor('#000000', 'notacolor', '#111111')).toBe('#000000');
  });

  it('uses default minContrast of 4.5 (normal text)', () => {
    // gray on white — contrast ~4.0, below 4.5 -> override
    expect(resolveTextColor('gray', 'white', 'black')).toBe('black');
  });

  it('respects custom minContrast', () => {
    // gray on white — contrast ~4.0, below strict 7.0 threshold
    expect(resolveTextColor('gray', 'white', 'black', 7)).toBe('black');
  });

  it('uses 3:1 threshold for large text when isLargeText is true', () => {
    // gray on white — contrast ~4.0, above 3:1 large text threshold
    expect(resolveTextColor('gray', 'white', 'black', undefined, true)).toBe('gray');
  });

  it('uses 4.5:1 threshold for normal text when isLargeText is false', () => {
    // gray on white — contrast ~4.0, below 4.5 normal text threshold
    expect(resolveTextColor('gray', 'white', 'black', undefined, false)).toBe('black');
  });

  it('minContrast takes precedence over isLargeText', () => {
    // explicit minContrast=3 overrides isLargeText=false default of 4.5
    expect(resolveTextColor('gray', 'white', 'black', 3)).toBe('gray');
  });

  it('works with named colors', () => {
    expect(resolveTextColor('black', 'white', 'red')).toBe('black');
  });

  it('works with shorthand hex', () => {
    expect(resolveTextColor('#000', '#fff', '#f00')).toBe('#000');
  });

  it('swaps similar colors', () => {
    // very similar: light gray on white
    expect(resolveTextColor('#eeeeee', '#ffffff', '#333333')).toBe('#333333');
  });

  it('works with rgb() colors', () => {
    // black text on white bg via rgb()
    expect(resolveTextColor('rgb(0, 0, 0)', 'rgb(255, 255, 255)', '#111111')).toBe('rgb(0, 0, 0)');
  });

  it('works with hsl() colors', () => {
    // black text on white bg via hsl()
    expect(resolveTextColor('hsl(0, 0, 0)', 'hsl(0, 0, 100)', '#111111')).toBe('hsl(0, 0, 0)');
  });
});
