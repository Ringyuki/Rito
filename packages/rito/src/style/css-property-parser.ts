import type { ComputedStyle } from './types';
import { applyBoxShorthand, applyBoxShorthandWithAuto, parseLength } from './parse-utils';
import {
  parseBorder,
  parseDisplay,
  parseFontStyle,
  parseFontWeight,
  parseLineHeight,
  parseListStyleType,
  parsePageBreak,
  parseTextAlign,
  parseTextDecoration,
  parseTextTransform,
  parseVerticalAlign,
  parseWhiteSpace,
} from './css-value-parsers';

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

// ── Property handler type ──────────────────────────────────────────

type Handler = (
  result: Record<string, unknown>,
  value: string,
  emBase: number,
  rootFontSize: number,
) => void;

// ── Property handler map ───────────────────────────────────────────

const MARGIN_KEYS = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'] as const;
const PADDING_KEYS = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const;

const PROPERTY_HANDLERS: Readonly<Record<string, Handler>> = {
  // Font
  color: (r, v) => {
    r['color'] = v;
  },
  'font-size': (r, v, em, root) => {
    const s = parseLength(v, em, root);
    if (s !== undefined) r['fontSize'] = s;
  },
  'font-family': (r, v) => {
    r['fontFamily'] = v;
  },
  'font-weight': (r, v) => {
    const w = parseFontWeight(v);
    if (w !== undefined) r['fontWeight'] = w;
  },
  'font-style': (r, v) => {
    const s = parseFontStyle(v);
    if (s !== undefined) r['fontStyle'] = s;
  },
  'line-height': (r, v, em, root) => {
    const lh = parseLineHeight(v, em, root);
    if (lh !== undefined) r['lineHeight'] = lh;
  },
  'letter-spacing': (r, v, em, root) => {
    const ls = parseLength(v, em, root);
    if (ls !== undefined) r['letterSpacing'] = ls;
  },
  'word-spacing': (r, v, em, root) => {
    const ws = parseLength(v, em, root);
    if (ws !== undefined) r['wordSpacing'] = ws;
  },

  // Text
  'text-align': (r, v) => {
    const a = parseTextAlign(v);
    if (a !== undefined) r['textAlign'] = a;
  },
  'text-decoration': (r, v) => {
    const d = parseTextDecoration(v);
    if (d !== undefined) r['textDecoration'] = d;
  },
  'text-indent': (r, v, em, root) => {
    const i = parseLength(v, em, root);
    if (i !== undefined) r['textIndent'] = i;
  },
  'text-transform': (r, v) => {
    const t = parseTextTransform(v);
    if (t !== undefined) r['textTransform'] = t;
  },
  'white-space': (r, v) => {
    const ws = parseWhiteSpace(v);
    if (ws !== undefined) r['whiteSpace'] = ws;
  },

  // Spacing
  'margin-top': (r, v, em, root) => {
    const m = parseLength(v, em, root);
    if (m !== undefined) r['marginTop'] = m;
  },
  'margin-right': (r, v, em, root) => {
    if (v.trim().toLowerCase() === 'auto') {
      r['marginRight'] = 0;
      r['marginRightAuto'] = true;
    } else {
      const m = parseLength(v, em, root);
      if (m !== undefined) {
        r['marginRight'] = m;
        r['marginRightAuto'] = false;
      }
    }
  },
  'margin-bottom': (r, v, em, root) => {
    const m = parseLength(v, em, root);
    if (m !== undefined) r['marginBottom'] = m;
  },
  'margin-left': (r, v, em, root) => {
    if (v.trim().toLowerCase() === 'auto') {
      r['marginLeft'] = 0;
      r['marginLeftAuto'] = true;
    } else {
      const m = parseLength(v, em, root);
      if (m !== undefined) {
        r['marginLeft'] = m;
        r['marginLeftAuto'] = false;
      }
    }
  },
  margin: (r, v, em, root) => {
    applyBoxShorthandWithAuto(r, v, em, MARGIN_KEYS, root);
  },
  'padding-top': (r, v, em, root) => {
    const p = parseLength(v, em, root);
    if (p !== undefined) r['paddingTop'] = p;
  },
  'padding-right': (r, v, em, root) => {
    const p = parseLength(v, em, root);
    if (p !== undefined) r['paddingRight'] = p;
  },
  'padding-bottom': (r, v, em, root) => {
    const p = parseLength(v, em, root);
    if (p !== undefined) r['paddingBottom'] = p;
  },
  'padding-left': (r, v, em, root) => {
    const p = parseLength(v, em, root);
    if (p !== undefined) r['paddingLeft'] = p;
  },
  padding: (r, v, em, root) => {
    applyBoxShorthand(r, v, em, PADDING_KEYS, root);
  },

  // Borders
  border: (r, v, em, root) => {
    const b = parseBorder(v, em, root);
    if (b) {
      r['borderTop'] = b;
      r['borderRight'] = b;
      r['borderBottom'] = b;
      r['borderLeft'] = b;
    }
  },
  'border-top': (r, v, em, root) => {
    const b = parseBorder(v, em, root);
    if (b) r['borderTop'] = b;
  },
  'border-right': (r, v, em, root) => {
    const b = parseBorder(v, em, root);
    if (b) r['borderRight'] = b;
  },
  'border-bottom': (r, v, em, root) => {
    const b = parseBorder(v, em, root);
    if (b) r['borderBottom'] = b;
  },
  'border-left': (r, v, em, root) => {
    const b = parseBorder(v, em, root);
    if (b) r['borderLeft'] = b;
  },

  // Vertical alignment
  'vertical-align': (r, v) => {
    const va = parseVerticalAlign(v);
    if (va !== undefined) r['verticalAlign'] = va;
  },

  // Layout
  display: (r, v) => {
    const d = parseDisplay(v);
    if (d !== undefined) r['display'] = d;
  },
  float: (r, v) => {
    const f = v.trim().toLowerCase();
    if (f === 'left' || f === 'right' || f === 'none') r['float'] = f;
  },
  clear: (r, v) => {
    const c = v.trim().toLowerCase();
    if (c === 'left' || c === 'right' || c === 'both' || c === 'none') r['clear'] = c;
  },
  width: (r, v, em, root) => {
    const w = parseLength(v, em, root);
    if (w !== undefined && w > 0) r['width'] = w;
  },
  'max-width': (r, v, em, root) => {
    const w = parseLength(v, em, root);
    if (w !== undefined && w > 0) r['maxWidth'] = w;
  },
  height: (r, v, em, root) => {
    const h = parseLength(v, em, root);
    if (h !== undefined && h > 0) r['height'] = h;
  },

  // Background
  'background-color': (r, v) => {
    r['backgroundColor'] = v;
  },
  background: (r, v) => {
    const bg = v.trim();
    if (bg && !bg.includes('url(') && !bg.includes('gradient'))
      r['backgroundColor'] = bg.split(/\s+/)[0] ?? '';
  },

  // Lists
  'list-style-type': (r, v) => {
    const l = parseListStyleType(v);
    if (l !== undefined) r['listStyleType'] = l;
  },
  'list-style': (r, v) => {
    // list-style is a shorthand that may contain type, position, and image.
    // Try each token for a recognized list-style-type.
    for (const token of v.trim().split(/\s+/)) {
      const l = parseListStyleType(token);
      if (l !== undefined) {
        r['listStyleType'] = l;
        return;
      }
    }
  },

  // Box model
  'box-sizing': (r, v) => {
    const bs = v.trim().toLowerCase();
    if (bs === 'border-box' || bs === 'content-box') r['boxSizing'] = bs;
  },

  // Page breaks
  'page-break-before': (r, v) => {
    const p = parsePageBreak(v);
    if (p !== undefined) r['pageBreakBefore'] = p;
  },
  'page-break-after': (r, v) => {
    const p = parsePageBreak(v);
    if (p !== undefined) r['pageBreakAfter'] = p;
  },
  'break-before': (r, v) => {
    const p = parsePageBreak(v);
    if (p !== undefined) r['pageBreakBefore'] = p;
  },
  'break-after': (r, v) => {
    const p = parsePageBreak(v);
    if (p !== undefined) r['pageBreakAfter'] = p;
  },
};
