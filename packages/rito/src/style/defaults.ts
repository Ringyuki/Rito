import type { ComputedStyle } from './types';
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
 * Non-inheritable CSS properties that should be reset when passing
 * a computed style to child elements.
 */
const NON_INHERITED_DEFAULTS: Partial<ComputedStyle> = {
  display: DISPLAY_VALUES.Block,
  marginTop: 0,
  marginRight: 0,
  marginBottom: 0,
  marginLeft: 0,
  paddingTop: 0,
  paddingRight: 0,
  paddingBottom: 0,
  paddingLeft: 0,
  backgroundColor: '',
  borderTop: { width: 0, color: '#000000', style: 'none' },
  borderRight: { width: 0, color: '#000000', style: 'none' },
  borderBottom: { width: 0, color: '#000000', style: 'none' },
  borderLeft: { width: 0, color: '#000000', style: 'none' },
  float: 'none',
  width: 0,
  maxWidth: 0,
  height: 0,
  pageBreakBefore: PAGE_BREAKS.Auto,
  pageBreakAfter: PAGE_BREAKS.Auto,
};

/**
 * Strip non-inheritable properties from a style before passing to children.
 * In CSS, properties like width, margin, padding, border, etc. do not inherit.
 */
export function inheritableStyle(style: ComputedStyle): ComputedStyle {
  return { ...style, ...NON_INHERITED_DEFAULTS };
}

/** Default style values used when no explicit style is specified. */
export const DEFAULT_STYLE: ComputedStyle = {
  fontFamily: 'serif',
  fontSize: 16,
  fontWeight: FONT_WEIGHTS.Normal,
  fontStyle: FONT_STYLES.Normal,
  lineHeight: 1.5,
  textAlign: TEXT_ALIGNMENTS.Left,
  textDecoration: TEXT_DECORATIONS.None,
  textIndent: 0,
  color: '#000000',
  marginTop: 0,
  marginRight: 0,
  marginBottom: 0,
  marginLeft: 0,
  display: DISPLAY_VALUES.Block,
  paddingTop: 0,
  paddingRight: 0,
  paddingBottom: 0,
  paddingLeft: 0,
  backgroundColor: '',
  letterSpacing: 0,
  textTransform: TEXT_TRANSFORMS.None,
  whiteSpace: WHITE_SPACES.Normal,
  borderTop: { width: 0, color: '#000000', style: 'none' },
  borderRight: { width: 0, color: '#000000', style: 'none' },
  borderBottom: { width: 0, color: '#000000', style: 'none' },
  borderLeft: { width: 0, color: '#000000', style: 'none' },
  float: 'none',
  width: 0,
  maxWidth: 0,
  height: 0,
  listStyleType: LIST_STYLE_TYPES.None,
  pageBreakBefore: PAGE_BREAKS.Auto,
  pageBreakAfter: PAGE_BREAKS.Auto,
};
