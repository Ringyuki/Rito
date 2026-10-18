const MARK_PATTERN = /^\p{M}$/u;
/** Code points a font fallback may answer with a colour glyph. */
const MAYBE_COLOR_PATTERN =
  /^[\u{a9}\u{ae}\u{203c}\u{2049}\u{2122}\u{2139}\u{2194}-\u{21aa}\u{231a}-\u{23ff}\u{24c2}\u{25aa}-\u{25fe}\u{2600}-\u{27bf}\u{2934}\u{2935}\u{2b00}-\u{2bff}\u{3030}\u{303d}\u{3297}\u{3299}\u{1f000}-\u{1faff}]$/u;

export const PLAIN_CODE_POINT = 1;
/** A combining mark (variation selectors among them): it is positioned on the glyph before it. */
export const COMBINING_MARK = 2;
/** A code point a font fallback may draw in colours of its own. */
export const MAYBE_COLOR_GLYPH = 3;

// What each code point is, worked out the first time it is seen; 0 is
// not seen yet.
const bmp = new Uint8Array(0x10000);
const astral = new Map<number, number>();

export function codePointKind(code: number): number {
  if (code < 0x10000) {
    const known = bmp[code] ?? 0;
    if (known !== 0) return known;
    const kind = classify(code);
    bmp[code] = kind;
    return kind;
  }
  let kind = astral.get(code);
  if (kind === undefined) {
    kind = classify(code);
    astral.set(code, kind);
  }
  return kind;
}

function classify(code: number): number {
  const character = String.fromCodePoint(code);
  if (MARK_PATTERN.test(character)) return COMBINING_MARK;
  if (MAYBE_COLOR_PATTERN.test(character)) return MAYBE_COLOR_GLYPH;
  return PLAIN_CODE_POINT;
}
