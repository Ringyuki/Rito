import type { ComputedStyle } from './types';
import { PROPERTY_HANDLERS } from './css-property-handlers';

const DEFAULT_ROOT_FONT_SIZE = 16;

/**
 * Parse a CSS declaration string (e.g. `"color: red; font-size: 18px"`)
 * into a partial ComputedStyle. Unknown properties are ignored.
 *
 * @param css - The raw CSS declaration string.
 * @param parentFontSize - The em basis in px (inherited font size).
 * @param rootFontSize - The rem basis in px (root element font size, default 16).
 */
export function parseCssDeclarations(
  css: string,
  parentFontSize: number,
  rootFontSize: number = DEFAULT_ROOT_FONT_SIZE,
): Partial<ComputedStyle> {
  const result: Record<string, unknown> = {};

  for (const declaration of css.split(';')) {
    const colonIndex = declaration.indexOf(':');
    if (colonIndex === -1) continue;

    const property = declaration.slice(0, colonIndex).trim().toLowerCase();
    const value = declaration.slice(colonIndex + 1).trim();
    if (!property || !value) continue;

    const handler = PROPERTY_HANDLERS[property];
    if (handler) handler(result, value, parentFontSize, rootFontSize);
  }

  return result as Partial<ComputedStyle>;
}
