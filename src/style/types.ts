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

/** Computed style for a layout element. */
export interface ComputedStyle {
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight: FontWeight;
  readonly fontStyle: FontStyle;
  readonly lineHeight: number;
  readonly textAlign: TextAlignment;
  readonly color: string;
  readonly marginTop: number;
  readonly marginBottom: number;
}

/** A document node paired with its resolved computed style. */
export interface StyledNode {
  readonly type: 'block' | 'inline' | 'text';
  readonly tag?: string;
  readonly content?: string;
  readonly style: ComputedStyle;
  readonly children: readonly StyledNode[];
}
