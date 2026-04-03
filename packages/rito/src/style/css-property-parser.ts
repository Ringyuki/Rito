import type {
  BorderSide,
  ComputedStyle,
  Display,
  FontStyle,
  FontWeight,
  ListStyleType,
  PageBreak,
  TextAlignment,
  TextDecoration,
  TextTransform,
  WhiteSpace,
} from './types';
import {
  DISPLAY_VALUES,
  FONT_STYLES,
  FONT_WEIGHTS,
  LIST_STYLE_TYPES,
  PAGE_BREAKS,
  TEXT_ALIGNMENTS,
  TEXT_DECORATIONS,
  TEXT_TRANSFORMS,
  WHITE_SPACES,
} from './types';
import { applyBoxShorthand, parseLength } from './parse-utils';

/**
 * Parse a CSS declaration string (e.g. `"color: red; font-size: 18px"`)
 * into a partial ComputedStyle. Unknown properties are ignored.
 */
export function parseCssDeclarations(css: string, parentFontSize: number): Partial<ComputedStyle> {
  const result: Record<string, unknown> = {};

  for (const declaration of css.split(';')) {
    const colonIndex = declaration.indexOf(':');
    if (colonIndex === -1) continue;

    const property = declaration.slice(0, colonIndex).trim().toLowerCase();
    const value = declaration.slice(colonIndex + 1).trim();
    if (!property || !value) continue;

    const handler = PROPERTY_HANDLERS[property];
    if (handler) handler(result, value, parentFontSize);
  }

  return result as Partial<ComputedStyle>;
}

// ── Property handler type ──────────────────────────────────────────

type Handler = (result: Record<string, unknown>, value: string, emBase: number) => void;

// ── Property handler map ───────────────────────────────────────────

const MARGIN_KEYS = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'] as const;
const PADDING_KEYS = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const;

const PROPERTY_HANDLERS: Readonly<Record<string, Handler>> = {
  // Font
  'color': (r, v) => { r['color'] = v; },
  'font-size': (r, v, em) => { const s = parseLength(v, em); if (s !== undefined) r['fontSize'] = s; },
  'font-family': (r, v) => { r['fontFamily'] = v; },
  'font-weight': (r, v) => { const w = parseFontWeight(v); if (w !== undefined) r['fontWeight'] = w; },
  'font-style': (r, v) => { const s = parseFontStyle(v); if (s !== undefined) r['fontStyle'] = s; },
  'line-height': (r, v, em) => { const lh = parseLineHeight(v, em); if (lh !== undefined) r['lineHeight'] = lh; },
  'letter-spacing': (r, v, em) => { const ls = parseLength(v, em); if (ls !== undefined) r['letterSpacing'] = ls; },

  // Text
  'text-align': (r, v) => { const a = parseTextAlign(v); if (a !== undefined) r['textAlign'] = a; },
  'text-decoration': (r, v) => { const d = parseTextDecoration(v); if (d !== undefined) r['textDecoration'] = d; },
  'text-indent': (r, v, em) => { const i = parseLength(v, em); if (i !== undefined) r['textIndent'] = i; },
  'text-transform': (r, v) => { const t = parseTextTransform(v); if (t !== undefined) r['textTransform'] = t; },
  'white-space': (r, v) => { const ws = parseWhiteSpace(v); if (ws !== undefined) r['whiteSpace'] = ws; },

  // Spacing
  'margin-top': (r, v, em) => { const m = parseLength(v, em); if (m !== undefined) r['marginTop'] = m; },
  'margin-right': (r, v, em) => { const m = parseLength(v, em); if (m !== undefined) r['marginRight'] = m; },
  'margin-bottom': (r, v, em) => { const m = parseLength(v, em); if (m !== undefined) r['marginBottom'] = m; },
  'margin-left': (r, v, em) => { const m = parseLength(v, em); if (m !== undefined) r['marginLeft'] = m; },
  'margin': (r, v, em) => { applyBoxShorthand(r, v, em, MARGIN_KEYS); },
  'padding-top': (r, v, em) => { const p = parseLength(v, em); if (p !== undefined) r['paddingTop'] = p; },
  'padding-right': (r, v, em) => { const p = parseLength(v, em); if (p !== undefined) r['paddingRight'] = p; },
  'padding-bottom': (r, v, em) => { const p = parseLength(v, em); if (p !== undefined) r['paddingBottom'] = p; },
  'padding-left': (r, v, em) => { const p = parseLength(v, em); if (p !== undefined) r['paddingLeft'] = p; },
  'padding': (r, v, em) => { applyBoxShorthand(r, v, em, PADDING_KEYS); },

  // Borders
  'border': (r, v, em) => { const b = parseBorder(v, em); if (b) { r['borderTop'] = b; r['borderRight'] = b; r['borderBottom'] = b; r['borderLeft'] = b; } },
  'border-top': (r, v, em) => { const b = parseBorder(v, em); if (b) r['borderTop'] = b; },
  'border-right': (r, v, em) => { const b = parseBorder(v, em); if (b) r['borderRight'] = b; },
  'border-bottom': (r, v, em) => { const b = parseBorder(v, em); if (b) r['borderBottom'] = b; },
  'border-left': (r, v, em) => { const b = parseBorder(v, em); if (b) r['borderLeft'] = b; },

  // Layout
  'display': (r, v) => { const d = parseDisplay(v); if (d !== undefined) r['display'] = d; },
  'float': (r, v) => { const f = v.trim().toLowerCase(); if (f === 'left' || f === 'right' || f === 'none') r['float'] = f; },
  'width': (r, v, em) => { const w = parseLength(v, em); if (w !== undefined && w > 0) r['width'] = w; },
  'max-width': (r, v, em) => { const w = parseLength(v, em); if (w !== undefined && w > 0) r['maxWidth'] = w; },
  'height': (r, v, em) => { const h = parseLength(v, em); if (h !== undefined && h > 0) r['height'] = h; },

  // Background
  'background-color': (r, v) => { r['backgroundColor'] = v; },
  'background': (r, v) => { const bg = v.trim(); if (bg && !bg.includes('url(') && !bg.includes('gradient')) r['backgroundColor'] = bg.split(/\s+/)[0] ?? ''; },

  // Lists
  'list-style-type': (r, v) => { const l = parseListStyleType(v); if (l !== undefined) r['listStyleType'] = l; },
  'list-style': (r, v) => { const l = parseListStyleType(v); if (l !== undefined) r['listStyleType'] = l; },

  // Page breaks
  'page-break-before': (r, v) => { const p = parsePageBreak(v); if (p !== undefined) r['pageBreakBefore'] = p; },
  'page-break-after': (r, v) => { const p = parsePageBreak(v); if (p !== undefined) r['pageBreakAfter'] = p; },
  'break-before': (r, v) => { const p = parsePageBreak(v); if (p !== undefined) r['pageBreakBefore'] = p; },
  'break-after': (r, v) => { const p = parsePageBreak(v); if (p !== undefined) r['pageBreakAfter'] = p; },
};

// ── Value parsers ──────────────────────────────────────────────────

function parseFontWeight(value: string): FontWeight | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'bold') return FONT_WEIGHTS.Bold;
  if (v === 'normal') return FONT_WEIGHTS.Normal;
  const num = parseInt(v, 10);
  if (!isNaN(num)) return num >= 600 ? FONT_WEIGHTS.Bold : FONT_WEIGHTS.Normal;
  return undefined;
}

function parseFontStyle(value: string): FontStyle | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'italic' || v === 'oblique') return FONT_STYLES.Italic;
  if (v === 'normal') return FONT_STYLES.Normal;
  return undefined;
}

function parseLineHeight(value: string, parentFontSize: number): number | undefined {
  const v = value.trim().toLowerCase();
  if (v.endsWith('px')) return parseFloat(v) / parentFontSize;
  if (v.endsWith('em')) return parseFloat(v);
  if (v.endsWith('%')) return parseFloat(v) / 100;
  const num = parseFloat(v);
  if (!isNaN(num)) return num;
  return undefined;
}

function parseTextAlign(value: string): TextAlignment | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'left') return TEXT_ALIGNMENTS.Left;
  if (v === 'center') return TEXT_ALIGNMENTS.Center;
  if (v === 'right') return TEXT_ALIGNMENTS.Right;
  if (v === 'justify') return TEXT_ALIGNMENTS.Justify;
  return undefined;
}

function parseTextDecoration(value: string): TextDecoration | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'none') return TEXT_DECORATIONS.None;
  if (v === 'underline') return TEXT_DECORATIONS.Underline;
  if (v === 'line-through') return TEXT_DECORATIONS.LineThrough;
  return undefined;
}

function parseTextTransform(value: string): TextTransform | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'none') return TEXT_TRANSFORMS.None;
  if (v === 'uppercase') return TEXT_TRANSFORMS.Uppercase;
  if (v === 'lowercase') return TEXT_TRANSFORMS.Lowercase;
  if (v === 'capitalize') return TEXT_TRANSFORMS.Capitalize;
  return undefined;
}

function parseWhiteSpace(value: string): WhiteSpace | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'normal') return WHITE_SPACES.Normal;
  if (v === 'pre') return WHITE_SPACES.Pre;
  if (v === 'pre-wrap') return WHITE_SPACES.PreWrap;
  if (v === 'nowrap') return WHITE_SPACES.Nowrap;
  return undefined;
}

function parseDisplay(value: string): Display | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'block') return DISPLAY_VALUES.Block;
  if (v === 'inline') return DISPLAY_VALUES.Inline;
  if (v === 'none') return DISPLAY_VALUES.None;
  return undefined;
}

function parseListStyleType(value: string): ListStyleType | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'disc' || v === 'circle' || v === 'square') return LIST_STYLE_TYPES.Disc;
  if (v === 'decimal' || v === 'decimal-leading-zero') return LIST_STYLE_TYPES.Decimal;
  if (v === 'none') return LIST_STYLE_TYPES.None;
  return undefined;
}

function parsePageBreak(value: string): PageBreak | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'always' || v === 'page') return PAGE_BREAKS.Always;
  if (v === 'auto') return PAGE_BREAKS.Auto;
  return undefined;
}

function parseBorder(value: string, parentFontSize: number): BorderSide | undefined {
  const parts = value.trim().split(/\s+/);
  if (parts.length === 0) return undefined;

  let width = 1;
  let color = '#000000';
  let style: 'solid' | 'none' = 'solid';

  for (const part of parts) {
    if (part === 'none' || part === 'hidden') {
      style = 'none';
    } else if (part === 'solid' || part === 'dotted' || part === 'dashed' || part === 'double') {
      style = 'solid';
    } else {
      const len = parseLength(part, parentFontSize);
      if (len !== undefined) {
        width = len;
      } else {
        color = part;
      }
    }
  }

  return { width, color, style };
}
