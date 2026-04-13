// Style types — computed CSS properties used by the layout and render layers.

import type { SourceRef } from '../../parser/xhtml/types';

/** Supported font weight values (CSS numeric scale 100-900). */
export const FONT_WEIGHTS = {
  Normal: 400,
  Bold: 700,
} as const;

export type FontWeight = number;

/** Supported font style values. */
export const FONT_STYLES = {
  Normal: 'normal',
  Italic: 'italic',
} as const;

export type FontStyle = (typeof FONT_STYLES)[keyof typeof FONT_STYLES];

/** Supported text alignment values. */
export const TEXT_ALIGNMENTS = {
  Left: 'left',
  Center: 'center',
  Right: 'right',
  Justify: 'justify',
} as const;

export type TextAlignment = (typeof TEXT_ALIGNMENTS)[keyof typeof TEXT_ALIGNMENTS];

/** Supported text decoration values. */
export const TEXT_DECORATIONS = {
  None: 'none',
  Underline: 'underline',
  LineThrough: 'line-through',
} as const;

export type TextDecoration = (typeof TEXT_DECORATIONS)[keyof typeof TEXT_DECORATIONS];

/** Supported list style type values. */
export const LIST_STYLE_TYPES = {
  Disc: 'disc',
  Decimal: 'decimal',
  LowerAlpha: 'lower-alpha',
  UpperAlpha: 'upper-alpha',
  LowerRoman: 'lower-roman',
  UpperRoman: 'upper-roman',
  Square: 'square',
  Circle: 'circle',
  None: 'none',
} as const;

export type ListStyleType = (typeof LIST_STYLE_TYPES)[keyof typeof LIST_STYLE_TYPES];

/** Supported display values. */
export const DISPLAY_VALUES = {
  Block: 'block',
  Inline: 'inline',
  InlineBlock: 'inline-block',
  None: 'none',
} as const;

export type Display = (typeof DISPLAY_VALUES)[keyof typeof DISPLAY_VALUES];

/** Supported vertical-align values. */
export const VERTICAL_ALIGNS = {
  Baseline: 'baseline',
  Top: 'top',
  Middle: 'middle',
  Bottom: 'bottom',
  Super: 'super',
  Sub: 'sub',
  TextTop: 'text-top',
  TextBottom: 'text-bottom',
} as const;

export type VerticalAlign = (typeof VERTICAL_ALIGNS)[keyof typeof VERTICAL_ALIGNS];

/** Supported text-transform values. */
export const TEXT_TRANSFORMS = {
  None: 'none',
  Uppercase: 'uppercase',
  Lowercase: 'lowercase',
  Capitalize: 'capitalize',
} as const;

export type TextTransform = (typeof TEXT_TRANSFORMS)[keyof typeof TEXT_TRANSFORMS];

/** Supported white-space values. */
export const WHITE_SPACES = {
  Normal: 'normal',
  Pre: 'pre',
  PreWrap: 'pre-wrap',
  Nowrap: 'nowrap',
} as const;

export type WhiteSpace = (typeof WHITE_SPACES)[keyof typeof WHITE_SPACES];

/** Supported overflow values. */
export const OVERFLOW_VALUES = {
  Visible: 'visible',
  Hidden: 'hidden',
} as const;

export type Overflow = (typeof OVERFLOW_VALUES)[keyof typeof OVERFLOW_VALUES];

/** Supported box-sizing values. */
export const BOX_SIZING_VALUES = {
  ContentBox: 'content-box',
  BorderBox: 'border-box',
} as const;

export type BoxSizing = (typeof BOX_SIZING_VALUES)[keyof typeof BOX_SIZING_VALUES];

/** Supported page-break values. */
export const PAGE_BREAKS = {
  Auto: 'auto',
  Always: 'always',
} as const;

export type PageBreak = (typeof PAGE_BREAKS)[keyof typeof PAGE_BREAKS];

/** Supported CSS position values. */
export const POSITIONS = {
  Static: 'static',
  Relative: 'relative',
  Absolute: 'absolute',
} as const;

export type Position = (typeof POSITIONS)[keyof typeof POSITIONS];

/** Supported CSS object-fit values. */
export const OBJECT_FIT_VALUES = {
  Fill: 'fill',
  Contain: 'contain',
  Cover: 'cover',
  ScaleDown: 'scale-down',
} as const;

export type ObjectFit = (typeof OBJECT_FIT_VALUES)[keyof typeof OBJECT_FIT_VALUES];

/** Computed style for a layout element. */
export interface ComputedStyle {
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight: FontWeight;
  readonly fontStyle: FontStyle;
  readonly lineHeight: number;
  /**
   * Absolute line-height in px, set when CSS line-height has units (em, px, rem, %).
   * When set, this value inherits as-is and takes priority over the `lineHeight`
   * multiplier. CSS `line-height: 1em` computes to an absolute px value and
   * inherits that value, while unitless `line-height: 1` inherits as a multiplier.
   */
  readonly lineHeightPx?: number;
  readonly textAlign: TextAlignment;
  readonly textDecoration: TextDecoration;
  readonly textIndent: number;
  readonly color: string;
  readonly marginTop: number;
  readonly marginRight: number;
  readonly marginBottom: number;
  readonly marginLeft: number;
  /** Percentage margin (0–100), resolved against containing block width at layout time. */
  readonly marginTopPct?: number;
  readonly marginRightPct?: number;
  readonly marginBottomPct?: number;
  readonly marginLeftPct?: number;
  readonly display: Display;
  readonly paddingTop: number;
  readonly paddingRight: number;
  readonly paddingBottom: number;
  readonly paddingLeft: number;
  /** Percentage padding (0–100), resolved against containing block width at layout time. */
  readonly paddingTopPct?: number;
  readonly paddingRightPct?: number;
  readonly paddingBottomPct?: number;
  readonly paddingLeftPct?: number;
  readonly backgroundColor: string;
  readonly letterSpacing: number;
  readonly wordSpacing: number;
  readonly textTransform: TextTransform;
  readonly whiteSpace: WhiteSpace;
  readonly borderTop: BorderSide;
  readonly borderRight: BorderSide;
  readonly borderBottom: BorderSide;
  readonly borderLeft: BorderSide;
  readonly float: 'none' | 'left' | 'right';
  readonly clear: 'none' | 'left' | 'right' | 'both';
  /** Explicit width in px. 0 means auto (not set). */
  readonly width: number;
  /** Percentage width (0–100), resolved against containing block width at layout time. */
  readonly widthPct?: number;
  /** Maximum width in px. 0 means no constraint. */
  readonly maxWidth: number;
  /** Percentage max-width (0–100), resolved against containing block width at layout time. */
  readonly maxWidthPct?: number;
  /** Explicit height in px. 0 means auto (not set). */
  readonly height: number;
  /** Minimum height in px. undefined means no constraint. */
  readonly minHeight: number | undefined;
  /** Maximum height in px. undefined means no constraint. */
  readonly maxHeight: number | undefined;
  /** CSS overflow mode. */
  readonly overflow: Overflow;
  readonly listStyleType: ListStyleType;
  /** Whether margin-left is set to 'auto'. */
  readonly marginLeftAuto: boolean;
  /** Whether margin-right is set to 'auto'. */
  readonly marginRightAuto: boolean;
  /** CSS box-sizing model. */
  readonly boxSizing: BoxSizing;
  readonly verticalAlign: VerticalAlign;
  readonly pageBreakBefore: PageBreak;
  readonly pageBreakAfter: PageBreak;
  /** CSS position property. Only 'static' and 'relative' are supported. */
  readonly position: Position;
  /** Offset top in px for position:relative. */
  readonly top: number;
  /** Offset left in px for position:relative. */
  readonly left: number;
  /** Offset bottom in px for position:relative. */
  readonly bottom: number;
  /** Offset right in px for position:relative. */
  readonly right: number;
  /** Border radius in px. 0 means no rounding. Render-only, no layout impact. */
  readonly borderRadius: number;
  /** Percentage border-radius (0–100), resolved against element dimensions at layout time. */
  readonly borderRadiusPct?: number;
  /** Opacity (0-1). 1 means fully opaque. Render-only, no layout impact. */
  readonly opacity: number;
  /** Minimum lines before a page break (CSS orphans). Default 2. */
  readonly orphans: number;
  /** Minimum lines after a page break (CSS widows). Default 2. */
  readonly widows: number;
  /** Box shadow list. Empty means no shadow. */
  readonly boxShadow: readonly BoxShadow[];
  /** Text shadow list. Empty means no shadow. */
  readonly textShadow: readonly TextShadow[];
  /** CSS transform string. Render-only, no layout impact. */
  readonly transform: string;
  /** CSS object-fit for replaced elements (images). */
  readonly objectFit: ObjectFit;
  /** CSS background-image URL (resolved from `url(...)` syntax). */
  readonly backgroundImage?: string;
  /** CSS background-size. */
  readonly backgroundSize?: 'cover' | 'contain' | 'auto';
  /** CSS background-repeat. */
  readonly backgroundRepeat?: 'repeat' | 'no-repeat';
  /** CSS background-position. */
  readonly backgroundPosition?: string;
}

/** A single box-shadow value. */
export interface BoxShadow {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly blur: number;
  readonly spread: number;
  readonly color: string;
  readonly inset: boolean;
}

/** A single text-shadow value. */
export interface TextShadow {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly blur: number;
  readonly color: string;
}

/** A single border edge. */
export interface BorderSide {
  readonly width: number;
  readonly color: string;
  readonly style: 'solid' | 'dotted' | 'dashed' | 'none';
}

/** A single CSS rule: a selector paired with declarations. */
export interface CssRule {
  readonly selector: string;
  /** Pre-parsed declarations (resolved against base font size). */
  readonly declarations: Partial<ComputedStyle>;
  /** Raw CSS declaration string for re-parsing with correct em context. */
  readonly rawDeclarations: string;
}

/** A parsed @font-face rule. */
export interface FontFaceRule {
  readonly family: string;
  readonly src: string;
  readonly weight?: string;
  readonly style?: string;
}

/** Specificity as a 3-tuple: [id, class, element]. */
export type Specificity = readonly [number, number, number];

/** A document node paired with its resolved computed style. */
export interface StyledNode {
  readonly type: 'block' | 'inline' | 'text' | 'image';
  readonly tag?: string;
  readonly content?: string;
  readonly src?: string;
  readonly alt?: string;
  readonly id?: string;
  readonly href?: string;
  readonly colspan?: number;
  readonly rowspan?: number;
  readonly style: ComputedStyle;
  readonly children: readonly StyledNode[];
  readonly sourceRef?: SourceRef;
}
