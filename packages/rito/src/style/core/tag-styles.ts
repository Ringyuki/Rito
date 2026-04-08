import type { ComputedStyle } from './types';
import {
  FONT_STYLES,
  FONT_WEIGHTS,
  LIST_STYLE_TYPES,
  OBJECT_FIT_VALUES,
  TEXT_ALIGNMENTS,
  VERTICAL_ALIGNS,
  WHITE_SPACES,
} from './types';

/**
 * Partial style overrides applied when a specific HTML tag is encountered.
 * Missing fields inherit from the parent style.
 */
type PartialStyle = Partial<ComputedStyle>;

const TAG_STYLES: Readonly<Record<string, PartialStyle>> = {
  h1: { fontSize: 32, fontWeight: FONT_WEIGHTS.Bold, marginTop: 21, marginBottom: 21 },
  h2: { fontSize: 24, fontWeight: FONT_WEIGHTS.Bold, marginTop: 19, marginBottom: 19 },
  h3: { fontSize: 19, fontWeight: FONT_WEIGHTS.Bold, marginTop: 18, marginBottom: 18 },
  h4: { fontSize: 16, fontWeight: FONT_WEIGHTS.Bold, marginTop: 21, marginBottom: 21 },
  h5: { fontSize: 13, fontWeight: FONT_WEIGHTS.Bold, marginTop: 22, marginBottom: 22 },
  h6: { fontSize: 11, fontWeight: FONT_WEIGHTS.Bold, marginTop: 25, marginBottom: 25 },
  p: { marginTop: 16, marginBottom: 16 },
  blockquote: { marginTop: 16, marginBottom: 16, marginLeft: 40 },
  pre: {
    fontFamily: 'monospace',
    marginTop: 16,
    marginBottom: 16,
    whiteSpace: WHITE_SPACES.PreWrap,
  },
  code: { fontFamily: 'monospace' },
  em: { fontStyle: FONT_STYLES.Italic },
  i: { fontStyle: FONT_STYLES.Italic },
  strong: { fontWeight: FONT_WEIGHTS.Bold },
  b: { fontWeight: FONT_WEIGHTS.Bold },
  center: { textAlign: TEXT_ALIGNMENTS.Center },
  ul: { marginTop: 16, marginBottom: 16, paddingLeft: 40, listStyleType: LIST_STYLE_TYPES.Disc },
  ol: { marginTop: 16, marginBottom: 16, paddingLeft: 40, listStyleType: LIST_STYLE_TYPES.Decimal },
  li: { marginTop: 0, marginBottom: 0 },
  dl: { marginTop: 16, marginBottom: 16 },
  dt: { fontWeight: FONT_WEIGHTS.Bold },
  dd: { marginLeft: 40 },
  hr: { marginTop: 8, marginBottom: 8 },
  th: { fontWeight: FONT_WEIGHTS.Bold },
  sup: { verticalAlign: VERTICAL_ALIGNS.Super, fontSize: 13 },
  sub: { verticalAlign: VERTICAL_ALIGNS.Sub, fontSize: 13 },
  img: { objectFit: OBJECT_FIT_VALUES.Contain, boxSizing: 'border-box' as const },
};

/**
 * Get the partial style overrides for a given HTML tag.
 * Returns undefined if no overrides are defined for the tag.
 */
export function getTagStyle(tagName: string): PartialStyle | undefined {
  return TAG_STYLES[tagName];
}
