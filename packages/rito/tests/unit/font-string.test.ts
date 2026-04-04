import { describe, expect, it } from 'vitest';
import { buildFontString } from '../../src/render/text/font-string';
import { DEFAULT_STYLE } from '../../src/style/core/defaults';

describe('buildFontString', () => {
  it('builds default font string (weight 400 omitted)', () => {
    expect(buildFontString(DEFAULT_STYLE)).toBe('16px serif');
  });

  it('includes italic when fontStyle is italic', () => {
    const style = { ...DEFAULT_STYLE, fontStyle: 'italic' as const };
    expect(buildFontString(style)).toBe('italic 16px serif');
  });

  it('includes numeric weight when fontWeight is 700', () => {
    const style = { ...DEFAULT_STYLE, fontWeight: 700 };
    expect(buildFontString(style)).toBe('700 16px serif');
  });

  it('includes both italic and weight 700', () => {
    const style = {
      ...DEFAULT_STYLE,
      fontStyle: 'italic' as const,
      fontWeight: 700,
    };
    expect(buildFontString(style)).toBe('italic 700 16px serif');
  });

  it('uses custom font family and size', () => {
    const style = { ...DEFAULT_STYLE, fontFamily: 'monospace', fontSize: 24 };
    expect(buildFontString(style)).toBe('24px monospace');
  });

  it('includes weight 300 for light fonts', () => {
    const style = { ...DEFAULT_STYLE, fontWeight: 300 };
    expect(buildFontString(style)).toBe('300 16px serif');
  });

  it('includes weight 900 for black fonts', () => {
    const style = { ...DEFAULT_STYLE, fontWeight: 900 };
    expect(buildFontString(style)).toBe('900 16px serif');
  });
});
