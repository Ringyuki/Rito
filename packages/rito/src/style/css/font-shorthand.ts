import type { ComputedStyle } from '../core/types';
import type { FontShorthand, MeasurePaint } from '../core/paint-types';

/**
 * Assemble a FontShorthand from a resolved ComputedStyle.
 *
 * Called once per element during the style cascade's finalization step,
 * so that downstream consumers (layout measurer, render text layer) read a
 * single pre-assembled object instead of recombining scattered font-* fields.
 */
export function fontShorthandFromStyle(style: ComputedStyle): FontShorthand {
  return {
    style: style.fontStyle,
    weight: style.fontWeight,
    sizePx: style.fontSize,
    family: style.fontFamily,
  };
}

/**
 * Assemble the minimal paint subset a {@link TextMeasurer} requires.
 *
 * Wraps {@link fontShorthandFromStyle} and forwards word-spacing. Returns an
 * object without the `wordSpacingPx` key when the spacing is zero, so the
 * measurer's cache key stays stable across runs with the same font.
 */
export function measurePaintFromStyle(style: ComputedStyle): MeasurePaint {
  const font = fontShorthandFromStyle(style);
  return style.wordSpacing === 0 ? { font } : { font, wordSpacingPx: style.wordSpacing };
}
