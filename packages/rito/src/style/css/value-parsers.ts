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
  VerticalAlign,
  WhiteSpace,
} from '../core/types';
import {
  DISPLAY_VALUES,
  FONT_STYLES,
  FONT_WEIGHTS,
  LIST_STYLE_TYPES,
  PAGE_BREAKS,
  TEXT_ALIGNMENTS,
  TEXT_DECORATIONS,
  TEXT_TRANSFORMS,
  VERTICAL_ALIGNS,
  WHITE_SPACES,
} from '../core/types';
import { parseLength } from './parse-utils';

/**
 * CSS `lighter` lookup table per CSS Fonts Module Level 4.
 * Each entry: [maxInherited, resolvedWeight].
 */
const LIGHTER_MAP: ReadonlyArray<readonly [number, number]> = [
  [599, 100],
  [799, 400],
  [900, 700],
];

/**
 * CSS `bolder` lookup table per spec.
 * Maps inherited weight to the resolved bolder weight.
 */
const BOLDER_MAP: ReadonlyArray<readonly [number, number]> = [
  [349, 400],
  [549, 700],
  [900, 900],
];

function resolveLighter(inherited: number): number {
  for (const [threshold, result] of LIGHTER_MAP) {
    if (inherited <= threshold) return result;
  }
  return 700;
}

function resolveBolder(inherited: number): number {
  for (const [threshold, result] of BOLDER_MAP) {
    if (inherited <= threshold) return result;
  }
  return 900;
}

export function parseFontWeight(value: string, inheritedWeight?: number): FontWeight | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'bold') return FONT_WEIGHTS.Bold;
  if (v === 'normal') return FONT_WEIGHTS.Normal;
  if (v === 'lighter') return resolveLighter(inheritedWeight ?? FONT_WEIGHTS.Normal);
  if (v === 'bolder') return resolveBolder(inheritedWeight ?? FONT_WEIGHTS.Normal);
  const num = parseInt(v, 10);
  if (!isNaN(num) && num >= 1 && num <= 1000) return num;
  return undefined;
}

export function parseFontStyle(value: string): FontStyle | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'italic' || v === 'oblique') return FONT_STYLES.Italic;
  if (v === 'normal') return FONT_STYLES.Normal;
  return undefined;
}

export function parseLineHeight(
  value: string,
  parentFontSize: number,
  rootFontSize: number = 16,
): number | undefined {
  const v = value.trim().toLowerCase();

  // calc() line-heights: resolve to px then convert to ratio
  if (v.startsWith('calc(')) {
    const px = parseLength(v, parentFontSize, rootFontSize);
    if (px !== undefined) return px / parentFontSize;
    return undefined;
  }

  if (v.endsWith('px')) return parseFloat(v) / parentFontSize;
  if (v.endsWith('rem')) return (parseFloat(v) * rootFontSize) / parentFontSize;
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
  if (v === 'inline-block') return DISPLAY_VALUES.InlineBlock;
  if (v === 'none') return DISPLAY_VALUES.None;
  return undefined;
}

export function parseVerticalAlign(value: string): VerticalAlign | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'baseline') return VERTICAL_ALIGNS.Baseline;
  if (v === 'top') return VERTICAL_ALIGNS.Top;
  if (v === 'middle') return VERTICAL_ALIGNS.Middle;
  if (v === 'bottom') return VERTICAL_ALIGNS.Bottom;
  if (v === 'super') return VERTICAL_ALIGNS.Super;
  if (v === 'sub') return VERTICAL_ALIGNS.Sub;
  if (v === 'text-top') return VERTICAL_ALIGNS.TextTop;
  if (v === 'text-bottom') return VERTICAL_ALIGNS.TextBottom;
  return undefined;
}

export function parseListStyleType(value: string): ListStyleType | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'disc') return LIST_STYLE_TYPES.Disc;
  if (v === 'circle') return LIST_STYLE_TYPES.Circle;
  if (v === 'square') return LIST_STYLE_TYPES.Square;
  if (v === 'decimal' || v === 'decimal-leading-zero') return LIST_STYLE_TYPES.Decimal;
  if (v === 'lower-alpha' || v === 'lower-latin') return LIST_STYLE_TYPES.LowerAlpha;
  if (v === 'upper-alpha' || v === 'upper-latin') return LIST_STYLE_TYPES.UpperAlpha;
  if (v === 'lower-roman') return LIST_STYLE_TYPES.LowerRoman;
  if (v === 'upper-roman') return LIST_STYLE_TYPES.UpperRoman;
  if (v === 'none') return LIST_STYLE_TYPES.None;
  return undefined;
}

export function parsePageBreak(value: string): PageBreak | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'always' || v === 'page') return PAGE_BREAKS.Always;
  if (v === 'auto') return PAGE_BREAKS.Auto;
  return undefined;
}

export function parseBorder(
  value: string,
  parentFontSize: number,
  rootFontSize: number = 16,
): BorderSide | undefined {
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
      const len = parseLength(part, parentFontSize, rootFontSize);
      if (len !== undefined) {
        width = len;
      } else {
        color = part;
      }
    }
  }

  return { width, color, style };
}
