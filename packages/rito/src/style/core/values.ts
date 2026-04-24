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

/** Supported text-justify values. */
export const TEXT_JUSTIFY_VALUES = {
  Auto: 'auto',
  None: 'none',
  InterWord: 'inter-word',
  InterCharacter: 'inter-character',
} as const;

export type TextJustify = (typeof TEXT_JUSTIFY_VALUES)[keyof typeof TEXT_JUSTIFY_VALUES];

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

/** Supported CSS line-break values. */
export const LINE_BREAK_VALUES = {
  Auto: 'auto',
  Normal: 'normal',
  Strict: 'strict',
} as const;

export type LineBreak = (typeof LINE_BREAK_VALUES)[keyof typeof LINE_BREAK_VALUES];

/** Supported CSS word-break values. */
export const WORD_BREAK_VALUES = {
  Normal: 'normal',
  BreakAll: 'break-all',
  BreakWord: 'break-word',
  KeepAll: 'keep-all',
} as const;

export type WordBreak = (typeof WORD_BREAK_VALUES)[keyof typeof WORD_BREAK_VALUES];

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
