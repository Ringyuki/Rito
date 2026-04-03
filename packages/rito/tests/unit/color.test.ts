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

  it('is case insensitive for named colors', () => {
    expect(parseColor('BLACK')).toEqual([0, 0, 0]);
    expect(parseColor('White')).toEqual([255, 255, 255]);
    expect(parseColor('RED')).toEqual([255, 0, 0]);
  });

  it('trims whitespace', () => {
    expect(parseColor('  #ff0000  ')).toEqual([255, 0, 0]);
    expect(parseColor(' black ')).toEqual([0, 0, 0]);
  });

  it('returns undefined for unsupported formats', () => {
    expect(parseColor('rgb(255, 0, 0)')).toBeUndefined();
    expect(parseColor('rgba(0, 0, 0, 1)')).toBeUndefined();
    expect(parseColor('hsl(0, 100%, 50%)')).toBeUndefined();
  });

  it('returns undefined for invalid hex', () => {
    expect(parseColor('#gg0000')).toBeUndefined();
    expect(parseColor('#12345')).toBeUndefined();
    expect(parseColor('#1234')).toBeUndefined();
    expect(parseColor('#12345678')).toBeUndefined();
    expect(parseColor('#')).toBeUndefined();
  });

  it('returns undefined for unknown named colors', () => {
    expect(parseColor('magenta')).toBeUndefined();
    expect(parseColor('cyan')).toBeUndefined();
    expect(parseColor('nonsense')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(parseColor('')).toBeUndefined();
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
    expect(resolveTextColor('rgb(0,0,0)', '#ffffff', '#000000')).toBe('rgb(0,0,0)');
  });

  it('returns original when bg is unparseable', () => {
    expect(resolveTextColor('#000000', 'rgb(255,255,255)', '#111111')).toBe('#000000');
  });

  it('uses default minContrast of 3', () => {
    // gray on white — contrast ~4.0, above default 3
    expect(resolveTextColor('gray', 'white', 'black')).toBe('gray');
  });

  it('respects custom minContrast', () => {
    // gray on white — contrast ~4.0, below strict 7.0 threshold
    expect(resolveTextColor('gray', 'white', 'black', 7)).toBe('black');
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
});
