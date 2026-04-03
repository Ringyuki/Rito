import { describe, expect, it } from 'vitest';
import { buildFontString } from '../../src/render/font-string';
import { DEFAULT_STYLE } from '../../src/style/defaults';

describe('buildFontString', () => {
  it('builds default font string', () => {
    expect(buildFontString(DEFAULT_STYLE)).toBe('16px serif');
  });

  it('includes italic when fontStyle is italic', () => {
    const style = { ...DEFAULT_STYLE, fontStyle: 'italic' as const };
    expect(buildFontString(style)).toBe('italic 16px serif');
  });

  it('includes bold when fontWeight is bold', () => {
    const style = { ...DEFAULT_STYLE, fontWeight: 'bold' as const };
    expect(buildFontString(style)).toBe('bold 16px serif');
  });

  it('includes both italic and bold', () => {
    const style = {
      ...DEFAULT_STYLE,
      fontStyle: 'italic' as const,
      fontWeight: 'bold' as const,
    };
    expect(buildFontString(style)).toBe('italic bold 16px serif');
  });

  it('uses custom font family and size', () => {
    const style = { ...DEFAULT_STYLE, fontFamily: 'monospace', fontSize: 24 };
    expect(buildFontString(style)).toBe('24px monospace');
  });
});
