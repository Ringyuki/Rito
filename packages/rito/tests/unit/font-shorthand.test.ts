import { describe, expect, it } from 'vitest';
import { fontShorthandFromStyle, measurePaintFromStyle } from '../../src/style/css/font-shorthand';
import { DEFAULT_STYLE } from '../../src/style/core/defaults';

describe('fontShorthandFromStyle', () => {
  it('maps ComputedStyle font-* fields into a FontShorthand', () => {
    expect(fontShorthandFromStyle(DEFAULT_STYLE)).toEqual({
      style: 'normal',
      weight: 400,
      sizePx: 16,
      family: 'serif',
    });
  });

  it('propagates overrides from a partial ComputedStyle spread', () => {
    const style = {
      ...DEFAULT_STYLE,
      fontStyle: 'italic' as const,
      fontWeight: 700,
      fontSize: 24,
      fontFamily: 'Georgia',
    };
    expect(fontShorthandFromStyle(style)).toEqual({
      style: 'italic',
      weight: 700,
      sizePx: 24,
      family: 'Georgia',
    });
  });

  it('reflects the current fontSize even when style.font carries a stale one', () => {
    // Tests that consumers deriving fresh shorthand via this helper do NOT
    // accidentally read the pre-assembled `style.font` field after a partial
    // spread override.
    const stale = {
      ...DEFAULT_STYLE,
      fontSize: 10,
      // `font` still reflects DEFAULT_STYLE (sizePx: 16)
    };
    expect(fontShorthandFromStyle(stale).sizePx).toBe(10);
  });
});

describe('measurePaintFromStyle', () => {
  it('omits wordSpacingPx when wordSpacing is 0', () => {
    const paint = measurePaintFromStyle(DEFAULT_STYLE);
    expect(paint).toEqual({
      font: {
        style: 'normal',
        weight: 400,
        sizePx: 16,
        family: 'serif',
      },
    });
    expect('wordSpacingPx' in paint).toBe(false);
  });

  it('includes wordSpacingPx when wordSpacing is non-zero', () => {
    const paint = measurePaintFromStyle({ ...DEFAULT_STYLE, wordSpacing: 3 });
    expect(paint.wordSpacingPx).toBe(3);
  });

  it('negative wordSpacing is forwarded verbatim', () => {
    const paint = measurePaintFromStyle({ ...DEFAULT_STYLE, wordSpacing: -2 });
    expect(paint.wordSpacingPx).toBe(-2);
  });
});
