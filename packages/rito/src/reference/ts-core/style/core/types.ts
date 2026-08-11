// Style types — computed CSS properties used by the layout and render layers.

import type { SourceRef } from '../../parser/xhtml/types';
import type { BackgroundPosition, FontShorthand, TransformFn } from './paint-types';
import type {
  BoxSizing,
  Display,
  FontStyle,
  FontWeight,
  LineBreak,
  ListStyleType,
  ObjectFit,
  Overflow,
  PageBreak,
  Position,
  TextAlignment,
  TextDecoration,
  TextJustify,
  TextTransform,
  VerticalAlign,
  WhiteSpace,
  WordBreak,
} from './values';

export {
  BOX_SIZING_VALUES,
  DISPLAY_VALUES,
  FONT_STYLES,
  FONT_WEIGHTS,
  LINE_BREAK_VALUES,
  LIST_STYLE_TYPES,
  OBJECT_FIT_VALUES,
  OVERFLOW_VALUES,
  PAGE_BREAKS,
  POSITIONS,
  TEXT_ALIGNMENTS,
  TEXT_DECORATIONS,
  TEXT_JUSTIFY_VALUES,
  TEXT_TRANSFORMS,
  VERTICAL_ALIGNS,
  WHITE_SPACES,
  WORD_BREAK_VALUES,
} from './values';

export type {
  BoxSizing,
  Display,
  FontStyle,
  FontWeight,
  LineBreak,
  ListStyleType,
  ObjectFit,
  Overflow,
  PageBreak,
  Position,
  TextAlignment,
  TextDecoration,
  TextJustify,
  TextTransform,
  VerticalAlign,
  WhiteSpace,
  WordBreak,
} from './values';

/** Computed style for a layout element. */
export interface ComputedStyle {
  /**
   * Pre-assembled font shorthand — mirrors fontFamily/fontSize/fontWeight/fontStyle
   * so downstream consumers (measurer, renderer) can read a single object
   * instead of recombining scattered font-* fields. Assembled by the style
   * cascade finalizer (see {@link fontShorthandFromStyle}).
   */
  readonly font: FontShorthand;
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
  readonly textJustify: TextJustify;
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
  readonly lineBreak: LineBreak;
  readonly wordBreak: WordBreak;
  /** Inherited BCP-47 language tag from HTML `lang` / `xml:lang`; `und` means unspecified. */
  readonly language: string;
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
  /** CSS position property. Supports `static`, `relative`, and `absolute`. */
  readonly position: Position;
  /** Offset top in px for positioned elements. */
  readonly top: number;
  /** Offset left in px for positioned elements. */
  readonly left: number;
  /** Offset bottom in px for positioned elements. */
  readonly bottom: number;
  /** Offset right in px for positioned elements. */
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
  /**
   * CSS transform, pre-parsed into a list of structured functions. Empty
   * array means no transform. Render-only, no layout impact.
   */
  readonly transform: readonly TransformFn[];
  /** CSS object-fit for replaced elements (images). */
  readonly objectFit: ObjectFit;
  /** CSS background-image URL (resolved from `url(...)` syntax). */
  readonly backgroundImage?: string;
  /** CSS background-size. */
  readonly backgroundSize?: 'cover' | 'contain' | 'auto';
  /** CSS background-repeat. */
  readonly backgroundRepeat?: 'repeat' | 'no-repeat';
  /**
   * CSS background-position pre-parsed to per-axis LengthPct. `undefined` =
   * not set; paint defaults to `0% 0%` for size=auto or `50% 50%` for cover/contain.
   */
  readonly backgroundPosition?: BackgroundPosition;
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
  readonly style: 'solid' | 'dotted' | 'dashed' | 'double' | 'none';
}

/** CSS cascade origin tracked by the internal style resolver. */
export type CssRuleOrigin = 'ua' | 'author';

/** A single CSS rule: a selector paired with declarations. */
export interface CssRule {
  readonly selector: string;
  /** Cascade origin. Omitted means author for backward-compatible callers. */
  readonly origin?: CssRuleOrigin;
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
  /** Original text before parser-level default whitespace normalization. */
  readonly sourceText?: string;
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
