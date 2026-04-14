import { describe, expect, it } from 'vitest';
import { buildFontString } from '../../src/render/text/font-string';
import type { FontShorthand } from '../../src/style/core/paint-types';

const BASE: FontShorthand = {
  style: 'normal',
  weight: 400,
  sizePx: 16,
  family: 'serif',
};

describe('buildFontString', () => {
  it('builds default font string (weight 400 omitted)', () => {
    expect(buildFontString(BASE)).toBe('16px serif');
  });

  it('includes italic when style is italic', () => {
    expect(buildFontString({ ...BASE, style: 'italic' })).toBe('italic 16px serif');
  });

  it('includes numeric weight when weight is 700', () => {
    expect(buildFontString({ ...BASE, weight: 700 })).toBe('700 16px serif');
  });

  it('includes both italic and weight 700', () => {
    expect(buildFontString({ ...BASE, style: 'italic', weight: 700 })).toBe(
      'italic 700 16px serif',
    );
  });

  it('uses custom family and sizePx', () => {
    expect(buildFontString({ ...BASE, family: 'monospace', sizePx: 24 })).toBe('24px monospace');
  });

  it('includes weight 300 for light fonts', () => {
    expect(buildFontString({ ...BASE, weight: 300 })).toBe('300 16px serif');
  });

  it('includes weight 900 for black fonts', () => {
    expect(buildFontString({ ...BASE, weight: 900 })).toBe('900 16px serif');
  });
});
