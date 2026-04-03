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
} from './types';

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
  marginBottom: 0,
  display: DISPLAY_VALUES.Block,
  paddingTop: 0,
  paddingRight: 0,
  paddingBottom: 0,
  paddingLeft: 0,
  backgroundColor: '',
  letterSpacing: 0,
  textTransform: TEXT_TRANSFORMS.None,
  listStyleType: LIST_STYLE_TYPES.None,
  pageBreakBefore: PAGE_BREAKS.Auto,
  pageBreakAfter: PAGE_BREAKS.Auto,
};
