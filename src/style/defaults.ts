import type { ComputedStyle } from './types';
import { FONT_STYLES, FONT_WEIGHTS, TEXT_ALIGNMENTS } from './types';

/** Default style values used when no explicit style is specified. */
export const DEFAULT_STYLE: ComputedStyle = {
  fontFamily: 'serif',
  fontSize: 16,
  fontWeight: FONT_WEIGHTS.Normal,
  fontStyle: FONT_STYLES.Normal,
  lineHeight: 1.5,
  textAlign: TEXT_ALIGNMENTS.Left,
  color: '#000000',
};
