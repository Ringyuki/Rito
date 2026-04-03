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

/**
 * Parse a CSS declaration string into a partial ComputedStyle.
 *
 * Supports a practical subset of CSS properties commonly found in EPUB stylesheets.
 * Unknown properties and malformed declarations are silently ignored.
 *
 * @param css - A CSS declaration block (e.g. `"color: red; font-size: 18px"`).
 * @param parentFontSize - The parent element's font size in px, used for `em` unit resolution.
 */
export function parseCssDeclarations(css: string, parentFontSize: number): Partial<ComputedStyle> {
  const result: Record<string, unknown> = {};

  for (const declaration of css.split(';')) {
    const colonIndex = declaration.indexOf(':');
    if (colonIndex === -1) continue;

    const property = declaration.slice(0, colonIndex).trim().toLowerCase();
    const value = declaration.slice(colonIndex + 1).trim();
    if (!property || !value) continue;

    applyProperty(result, property, value, parentFontSize);
  }

  return result as Partial<ComputedStyle>;
}

function applyProperty(
  result: Record<string, unknown>,
  property: string,
  value: string,
  parentFontSize: number,
): void {
  switch (property) {
    case 'color':
      result['color'] = value;
      break;
    case 'font-size': {
      const size = parseLength(value, parentFontSize);
      if (size !== undefined) result['fontSize'] = size;
      break;
    }
    case 'font-family':
      result['fontFamily'] = value;
      break;
    case 'font-weight': {
      const weight = parseFontWeight(value);
      if (weight !== undefined) result['fontWeight'] = weight;
      break;
    }
    case 'font-style': {
      const style = parseFontStyle(value);
      if (style !== undefined) result['fontStyle'] = style;
      break;
    }
    case 'line-height': {
      const lh = parseLineHeight(value, parentFontSize);
      if (lh !== undefined) result['lineHeight'] = lh;
      break;
    }
    case 'text-align': {
      const align = parseTextAlign(value);
      if (align !== undefined) result['textAlign'] = align;
      break;
    }
    case 'text-decoration': {
      const decoration = parseTextDecoration(value);
      if (decoration !== undefined) result['textDecoration'] = decoration;
      break;
    }
    case 'text-indent': {
      const indent = parseLength(value, parentFontSize);
      if (indent !== undefined) result['textIndent'] = indent;
      break;
    }
    case 'margin-top': {
      const mt = parseLength(value, parentFontSize);
      if (mt !== undefined) result['marginTop'] = mt;
      break;
    }
    case 'margin-bottom': {
      const mb = parseLength(value, parentFontSize);
      if (mb !== undefined) result['marginBottom'] = mb;
      break;
    }
    case 'margin-left': {
      const ml = parseLength(value, parentFontSize);
      if (ml !== undefined) result['marginLeft'] = ml;
      break;
    }
    case 'margin-right': {
      const mr = parseLength(value, parentFontSize);
      if (mr !== undefined) result['marginRight'] = mr;
      break;
    }
    case 'margin': {
      applyMarginShorthand(result, value, parentFontSize);
      break;
    }
    case 'display': {
      const d = parseDisplay(value);
      if (d !== undefined) result['display'] = d;
      break;
    }
    case 'padding-top': {
      const pt = parseLength(value, parentFontSize);
      if (pt !== undefined) result['paddingTop'] = pt;
      break;
    }
    case 'padding-right': {
      const pr = parseLength(value, parentFontSize);
      if (pr !== undefined) result['paddingRight'] = pr;
      break;
    }
    case 'padding-bottom': {
      const pb2 = parseLength(value, parentFontSize);
      if (pb2 !== undefined) result['paddingBottom'] = pb2;
      break;
    }
    case 'padding-left': {
      const pl = parseLength(value, parentFontSize);
      if (pl !== undefined) result['paddingLeft'] = pl;
      break;
    }
    case 'padding': {
      applyPaddingShorthand(result, value, parentFontSize);
      break;
    }
    case 'border': {
      const b = parseBorderShorthand(value, parentFontSize);
      if (b) {
        result['borderTop'] = b;
        result['borderRight'] = b;
        result['borderBottom'] = b;
        result['borderLeft'] = b;
      }
      break;
    }
    case 'border-top': {
      const bt = parseBorderShorthand(value, parentFontSize);
      if (bt) result['borderTop'] = bt;
      break;
    }
    case 'border-right': {
      const br = parseBorderShorthand(value, parentFontSize);
      if (br) result['borderRight'] = br;
      break;
    }
    case 'border-bottom': {
      const bb = parseBorderShorthand(value, parentFontSize);
      if (bb) result['borderBottom'] = bb;
      break;
    }
    case 'border-left': {
      const bl = parseBorderShorthand(value, parentFontSize);
      if (bl) result['borderLeft'] = bl;
      break;
    }
    case 'float': {
      const fl = value.trim().toLowerCase();
      if (fl === 'left') result['float'] = 'left';
      else if (fl === 'right') result['float'] = 'right';
      else if (fl === 'none') result['float'] = 'none';
      break;
    }
    case 'width': {
      const w = parseLength(value, parentFontSize);
      if (w !== undefined && w > 0) result['width'] = w;
      break;
    }
    case 'max-width': {
      const mw = parseLength(value, parentFontSize);
      if (mw !== undefined && mw > 0) result['maxWidth'] = mw;
      break;
    }
    case 'height': {
      const h = parseLength(value, parentFontSize);
      if (h !== undefined && h > 0) result['height'] = h;
      break;
    }
    case 'background-color': {
      result['backgroundColor'] = value;
      break;
    }
    case 'background': {
      // Extract color from background shorthand (simple case: just a color)
      const bg = value.trim();
      if (bg && !bg.includes('url(') && !bg.includes('gradient')) {
        result['backgroundColor'] = bg.split(/\s+/)[0] ?? '';
      }
      break;
    }
    case 'letter-spacing': {
      const ls = parseLength(value, parentFontSize);
      if (ls !== undefined) result['letterSpacing'] = ls;
      break;
    }
    case 'text-transform': {
      const tt = parseTextTransform(value);
      if (tt !== undefined) result['textTransform'] = tt;
      break;
    }
    case 'white-space': {
      const ws = parseWhiteSpace(value);
      if (ws !== undefined) result['whiteSpace'] = ws;
      break;
    }
    case 'list-style-type':
    case 'list-style': {
      const lst = parseListStyleType(value);
      if (lst !== undefined) result['listStyleType'] = lst;
      break;
    }
    case 'page-break-before':
    case 'break-before': {
      const pb = parsePageBreak(value);
      if (pb !== undefined) result['pageBreakBefore'] = pb;
      break;
    }
    case 'page-break-after':
    case 'break-after': {
      const pa = parsePageBreak(value);
      if (pa !== undefined) result['pageBreakAfter'] = pa;
      break;
    }
  }
}

/** Parse the `margin` shorthand into top/bottom values. */
function applyMarginShorthand(
  result: Record<string, unknown>,
  value: string,
  parentFontSize: number,
): void {
  const parts = value.trim().split(/\s+/);
  const values = parts.map((p) => parseLength(p, parentFontSize));
  // CSS margin shorthand: 1=all, 2=TB+LR, 3=T+LR+B, 4=T+R+B+L
  if (parts.length === 1 && values[0] !== undefined) {
    result['marginTop'] = values[0];
    result['marginRight'] = values[0];
    result['marginBottom'] = values[0];
    result['marginLeft'] = values[0];
  } else if (parts.length === 2) {
    if (values[0] !== undefined) {
      result['marginTop'] = values[0];
      result['marginBottom'] = values[0];
    }
    if (values[1] !== undefined) {
      result['marginRight'] = values[1];
      result['marginLeft'] = values[1];
    }
  } else if (parts.length === 3) {
    if (values[0] !== undefined) result['marginTop'] = values[0];
    if (values[1] !== undefined) {
      result['marginRight'] = values[1];
      result['marginLeft'] = values[1];
    }
    if (values[2] !== undefined) result['marginBottom'] = values[2];
  } else if (parts.length >= 4) {
    if (values[0] !== undefined) result['marginTop'] = values[0];
    if (values[1] !== undefined) result['marginRight'] = values[1];
    if (values[2] !== undefined) result['marginBottom'] = values[2];
    if (values[3] !== undefined) result['marginLeft'] = values[3];
  }
}

/** Parse the `padding` shorthand into all four sides. */
function applyPaddingShorthand(
  result: Record<string, unknown>,
  value: string,
  parentFontSize: number,
): void {
  const parts = value.trim().split(/\s+/);
  const values = parts.map((p) => parseLength(p, parentFontSize));
  if (parts.length === 1 && values[0] !== undefined) {
    result['paddingTop'] = values[0];
    result['paddingRight'] = values[0];
    result['paddingBottom'] = values[0];
    result['paddingLeft'] = values[0];
  } else if (parts.length === 2) {
    if (values[0] !== undefined) {
      result['paddingTop'] = values[0];
      result['paddingBottom'] = values[0];
    }
    if (values[1] !== undefined) {
      result['paddingRight'] = values[1];
      result['paddingLeft'] = values[1];
    }
  } else if (parts.length === 3) {
    if (values[0] !== undefined) result['paddingTop'] = values[0];
    if (values[1] !== undefined) {
      result['paddingRight'] = values[1];
      result['paddingLeft'] = values[1];
    }
    if (values[2] !== undefined) result['paddingBottom'] = values[2];
  } else if (parts.length >= 4) {
    if (values[0] !== undefined) result['paddingTop'] = values[0];
    if (values[1] !== undefined) result['paddingRight'] = values[1];
    if (values[2] !== undefined) result['paddingBottom'] = values[2];
    if (values[3] !== undefined) result['paddingLeft'] = values[3];
  }
}

/** Parse a CSS length value (px, pt, em, %) to a number in px. */
function parseLength(value: string, parentFontSize: number): number | undefined {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.endsWith('px')) {
    return parseFloat(trimmed);
  }
  if (trimmed.endsWith('pt')) {
    return parseFloat(trimmed) * (4 / 3);
  }
  if (trimmed.endsWith('em')) {
    return parseFloat(trimmed) * parentFontSize;
  }
  if (trimmed.endsWith('%')) {
    // Approximate: treat % as fraction of parent font size
    return (parseFloat(trimmed) / 100) * parentFontSize;
  }
  // Bare number (e.g. "0")
  const num = parseFloat(trimmed);
  if (!isNaN(num) && /^\d/.test(trimmed)) {
    return num;
  }
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

/** Parse a CSS border shorthand (e.g. "1px solid #ccc"). */
function parseBorderShorthand(value: string, parentFontSize: number): BorderSide | undefined {
  const parts = value.trim().split(/\s+/);
  if (parts.length === 0) return undefined;

  let width = 1;
  let color = '#000000';
  let style: 'solid' | 'none' = 'solid';

  for (const part of parts) {
    if (part === 'none' || part === 'hidden') {
      style = 'none';
    } else if (part === 'solid' || part === 'dotted' || part === 'dashed' || part === 'double') {
      style = 'solid'; // Simplify all visible styles to solid
    } else {
      const len = parseLength(part, parentFontSize);
      if (len !== undefined) {
        width = len;
      } else {
        // Assume it's a color
        color = part;
      }
    }
  }

  return { width, color, style };
}

function parseFontWeight(value: string): FontWeight | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'bold') return FONT_WEIGHTS.Bold;
  if (v === 'normal') return FONT_WEIGHTS.Normal;
  const num = parseInt(v, 10);
  if (!isNaN(num)) {
    return num >= 600 ? FONT_WEIGHTS.Bold : FONT_WEIGHTS.Normal;
  }
  return undefined;
}

function parseFontStyle(value: string): FontStyle | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'italic' || v === 'oblique') return FONT_STYLES.Italic;
  if (v === 'normal') return FONT_STYLES.Normal;
  return undefined;
}

function parseLineHeight(value: string, parentFontSize: number): number | undefined {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.endsWith('px')) {
    return parseFloat(trimmed) / parentFontSize;
  }
  if (trimmed.endsWith('em')) {
    return parseFloat(trimmed);
  }
  if (trimmed.endsWith('%')) {
    return parseFloat(trimmed) / 100;
  }
  // Unitless number (preferred in CSS)
  const num = parseFloat(trimmed);
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

function parseDisplay(value: string): Display | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'block') return DISPLAY_VALUES.Block;
  if (v === 'inline') return DISPLAY_VALUES.Inline;
  if (v === 'none') return DISPLAY_VALUES.None;
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
