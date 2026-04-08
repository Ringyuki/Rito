import type { ComputedStyle } from '../core/types';
import type { MutableStylePatch } from '../core/style-patch';
import { PROPERTY_HANDLERS } from './property-handlers';

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
  const result: MutableStylePatch = {};

  for (const declaration of css.split(';')) {
    const colonIndex = declaration.indexOf(':');
    if (colonIndex === -1) continue;

    const property = declaration.slice(0, colonIndex).trim().toLowerCase();
    const raw = declaration.slice(colonIndex + 1).trim();
    if (!property || !raw) continue;
    // Strip !important — we don't implement priority but the value must parse correctly.
    const value = raw.endsWith('!important')
      ? raw.slice(0, -10).trim()
      : raw.endsWith('! important')
        ? raw.slice(0, -11).trim()
        : raw;

    const handler = PROPERTY_HANDLERS[property];
    if (handler) handler(result, value, parentFontSize, rootFontSize);
  }

  return result;
}
