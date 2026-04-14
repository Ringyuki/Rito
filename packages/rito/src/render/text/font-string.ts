import type { FontShorthand } from '../../style/core/paint-types';

/**
 * Serialize a FontShorthand to the CSS font-shorthand string Canvas expects.
 *
 * Format: `[italic ][weight ]sizepx family`. Weight 400 is the default and is
 * elided for shorter strings.
 */
export function buildFontString(font: FontShorthand): string {
  const parts: string[] = [];
  if (font.style === 'italic') parts.push('italic');
  if (font.weight !== 400) parts.push(String(font.weight));
  parts.push(`${String(font.sizePx)}px`);
  parts.push(font.family);
  return parts.join(' ');
}
