/**
 * Internal style representation.
 * A limited, explicit subset of styling rules for rendering.
 */

/** Supported font weight values. */
export const FONT_WEIGHTS = {
  Normal: 'normal',
  Bold: 'bold',
} as const;

export type FontWeight = (typeof FONT_WEIGHTS)[keyof typeof FONT_WEIGHTS];

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
  None: 'none',
} as const;

export type ListStyleType = (typeof LIST_STYLE_TYPES)[keyof typeof LIST_STYLE_TYPES];

/** Supported display values. */
export const DISPLAY_VALUES = {
  Block: 'block',
  Inline: 'inline',
  None: 'none',
} as const;

export type Display = (typeof DISPLAY_VALUES)[keyof typeof DISPLAY_VALUES];

/** Supported text-transform values. */
export const TEXT_TRANSFORMS = {
  None: 'none',
  Uppercase: 'uppercase',
  Lowercase: 'lowercase',
  Capitalize: 'capitalize',
} as const;

export type TextTransform = (typeof TEXT_TRANSFORMS)[keyof typeof TEXT_TRANSFORMS];

/** Supported page-break values. */
export const PAGE_BREAKS = {
  Auto: 'auto',
  Always: 'always',
} as const;

export type PageBreak = (typeof PAGE_BREAKS)[keyof typeof PAGE_BREAKS];

/** Computed style for a layout element. */
export interface ComputedStyle {
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight: FontWeight;
  readonly fontStyle: FontStyle;
  readonly lineHeight: number;
  readonly textAlign: TextAlignment;
  readonly textDecoration: TextDecoration;
  readonly textIndent: number;
  readonly color: string;
  readonly marginTop: number;
  readonly marginBottom: number;
  readonly display: Display;
  readonly paddingTop: number;
  readonly paddingRight: number;
  readonly paddingBottom: number;
  readonly paddingLeft: number;
  readonly backgroundColor: string;
  readonly letterSpacing: number;
  readonly textTransform: TextTransform;
  readonly borderTop: BorderSide;
  readonly borderRight: BorderSide;
  readonly borderBottom: BorderSide;
  readonly borderLeft: BorderSide;
  readonly listStyleType: ListStyleType;
  readonly pageBreakBefore: PageBreak;
  readonly pageBreakAfter: PageBreak;
}

/** A single border edge. */
export interface BorderSide {
  readonly width: number;
  readonly color: string;
  readonly style: 'solid' | 'none';
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
  readonly id?: string;
  readonly style: ComputedStyle;
  readonly children: readonly StyledNode[];
}
