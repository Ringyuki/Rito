import type {
  BorderSide,
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
import { parseLength } from './parse-utils';

export function parseFontWeight(value: string): FontWeight | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'bold') return FONT_WEIGHTS.Bold;
  if (v === 'normal') return FONT_WEIGHTS.Normal;
  const num = parseInt(v, 10);
  if (!isNaN(num)) return num >= 600 ? FONT_WEIGHTS.Bold : FONT_WEIGHTS.Normal;
  return undefined;
}

export function parseFontStyle(value: string): FontStyle | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'italic' || v === 'oblique') return FONT_STYLES.Italic;
  if (v === 'normal') return FONT_STYLES.Normal;
  return undefined;
}

export function parseLineHeight(value: string, parentFontSize: number): number | undefined {
  const v = value.trim().toLowerCase();
  if (v.endsWith('px')) return parseFloat(v) / parentFontSize;
  if (v.endsWith('em')) return parseFloat(v);
  if (v.endsWith('%')) return parseFloat(v) / 100;
  const num = parseFloat(v);
  if (!isNaN(num)) return num;
  return undefined;
}

export function parseTextAlign(value: string): TextAlignment | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'left') return TEXT_ALIGNMENTS.Left;
  if (v === 'center') return TEXT_ALIGNMENTS.Center;
  if (v === 'right') return TEXT_ALIGNMENTS.Right;
  if (v === 'justify') return TEXT_ALIGNMENTS.Justify;
  return undefined;
}

export function parseTextDecoration(value: string): TextDecoration | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'none') return TEXT_DECORATIONS.None;
  if (v === 'underline') return TEXT_DECORATIONS.Underline;
  if (v === 'line-through') return TEXT_DECORATIONS.LineThrough;
  return undefined;
}

export function parseTextTransform(value: string): TextTransform | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'none') return TEXT_TRANSFORMS.None;
  if (v === 'uppercase') return TEXT_TRANSFORMS.Uppercase;
  if (v === 'lowercase') return TEXT_TRANSFORMS.Lowercase;
  if (v === 'capitalize') return TEXT_TRANSFORMS.Capitalize;
  return undefined;
}

export function parseWhiteSpace(value: string): WhiteSpace | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'normal') return WHITE_SPACES.Normal;
  if (v === 'pre') return WHITE_SPACES.Pre;
  if (v === 'pre-wrap') return WHITE_SPACES.PreWrap;
  if (v === 'nowrap') return WHITE_SPACES.Nowrap;
  return undefined;
}

export function parseDisplay(value: string): Display | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'block') return DISPLAY_VALUES.Block;
  if (v === 'inline') return DISPLAY_VALUES.Inline;
  if (v === 'none') return DISPLAY_VALUES.None;
  return undefined;
}

export function parseListStyleType(value: string): ListStyleType | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'disc' || v === 'circle' || v === 'square') return LIST_STYLE_TYPES.Disc;
  if (v === 'decimal' || v === 'decimal-leading-zero') return LIST_STYLE_TYPES.Decimal;
  if (v === 'none') return LIST_STYLE_TYPES.None;
  return undefined;
}

export function parsePageBreak(value: string): PageBreak | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'always' || v === 'page') return PAGE_BREAKS.Always;
  if (v === 'auto') return PAGE_BREAKS.Auto;
  return undefined;
}

export function parseBorder(value: string, parentFontSize: number): BorderSide | undefined {
  const parts = value.trim().split(/\s+/);
  if (parts.length === 0) return undefined;

  let width = 1;
  let color = '#000000';
  let style: BorderSide['style'] = 'solid';

  for (const part of parts) {
    if (part === 'none' || part === 'hidden') {
      style = 'none';
    } else if (part === 'solid' || part === 'dotted' || part === 'dashed') {
      style = part;
    } else if (part === 'double' || part === 'groove' || part === 'ridge') {
      style = 'solid'; // approximate unsupported styles as solid
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
