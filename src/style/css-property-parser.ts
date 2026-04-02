import type { ComputedStyle, FontStyle, FontWeight, TextAlignment, TextDecoration } from './types';
import { FONT_STYLES, FONT_WEIGHTS, TEXT_ALIGNMENTS, TEXT_DECORATIONS } from './types';

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
  }
}

/** Parse a CSS length value (px, pt, em) to a number in px. */
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
  // Bare number (e.g. "0")
  const num = parseFloat(trimmed);
  if (!isNaN(num) && /^\d/.test(trimmed)) {
    return num;
  }
  return undefined;
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
  // line-height with units
  if (trimmed.endsWith('px')) {
    return parseFloat(trimmed) / parentFontSize;
  }
  if (trimmed.endsWith('em')) {
    return parseFloat(trimmed);
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
