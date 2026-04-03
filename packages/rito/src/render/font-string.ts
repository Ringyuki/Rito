import type { ComputedStyle } from '../style/types';

/** Build a CSS font shorthand string from a ComputedStyle. */
export function buildFontString(style: ComputedStyle): string {
  const parts: string[] = [];
  if (style.fontStyle === 'italic') parts.push('italic');
  if (style.fontWeight === 'bold') parts.push('bold');
  parts.push(`${String(style.fontSize)}px`);
  parts.push(style.fontFamily);
  return parts.join(' ');
}
