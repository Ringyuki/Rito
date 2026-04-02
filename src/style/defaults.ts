import type { ComputedStyle } from './types';
import { FONT_STYLES, FONT_WEIGHTS, TEXT_ALIGNMENTS, TEXT_DECORATIONS } from './types';

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
};
