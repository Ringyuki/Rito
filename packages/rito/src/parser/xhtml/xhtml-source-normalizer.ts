import { HTML_NAMED_ENTITIES } from './xhtml-named-entities';

const XML_DECLARATION_RE = /^(\uFEFF?)<\?xml\s+([^?]*?)\?>/;
const SINGLE_QUOTED_XML_DECLARATION_ATTRIBUTE_RE = /\b(version|encoding|standalone)='([^']*)'/g;

// Matches `&` optionally followed by a numeric reference or a named token.
// Group 1 (when present) is the entity body without the leading `&`.
const AMPERSAND_RE = /&(#x[0-9a-fA-F]+;|#[0-9]+;|[a-zA-Z][a-zA-Z0-9]*;)?/g;

// Regions where `&` is already literal and must be preserved verbatim:
// comments and CDATA sections (common around inline <script>/<style>).
const PRESERVED_REGION_RE = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g;

// Entities that the XML parser understands without a DTD — left untouched.
const XML_PREDEFINED = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);

// Characters XML 1.0 forbids outright (not even escapable): C0 controls except
// TAB/LF/CR, the U+FFFE/U+FFFF noncharacters, and lone surrogates (valid astral
// pairs are kept). They show up as junk in some EPUBs and abort the parse with
// "PCDATA invalid Char value N".
const ILLEGAL_XML_CHARS_RE =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Normalize XHTML source quirks commonly found in EPUB files before XML parsing.
 *
 * Real EPUB chapters routinely contain markup that a strict
 * `application/xhtml+xml` parser (browser or libxml2) rejects but that
 * authors expect to work: raw ampersands (e.g. `Schmidt & Bender`), HTML named
 * entities (`&copy;`, `&mdash;`, `&nbsp;`) that are undefined without a DTD, and
 * stray control characters illegal in XML. Each aborts parsing of the whole chapter.
 *
 * This layer rewrites the source so such chapters parse, without turning
 * malformed markup into a full HTML parser path:
 *   - characters illegal in XML (and numeric refs pointing to them) are dropped
 *   - valid numeric and XML-predefined references are preserved verbatim
 *   - known HTML named entities are remapped to numeric character references
 *   - every other `&` (bare, or an unknown `&name;`) is escaped to `&amp;`
 *
 * Comments and CDATA sections are preserved verbatim, since `&` is already
 * literal there.
 */
export function normalizeXhtmlSource(source: string): string {
  return normalizeAmpersandsOutsidePreserved(normalizeXmlDeclaration(stripIllegalXmlChars(source)));
}

/** Calculate the post-normalization size without allocating the expanded output. */
export function estimateNormalizedXhtmlSourceLength(source: string): number {
  const sanitizedSource = stripIllegalXmlChars(source);
  let normalizedLength = sanitizedSource.length;
  let lastIndex = 0;
  for (const match of sanitizedSource.matchAll(PRESERVED_REGION_RE)) {
    normalizedLength += normalizedAmpersandLengthDelta(
      sanitizedSource.slice(lastIndex, match.index),
    );
    lastIndex = match.index + match[0].length;
  }
  return normalizedLength + normalizedAmpersandLengthDelta(sanitizedSource.slice(lastIndex));
}

/** Bound both hostile raw input and the normalized string it may expand into. */
export function isXhtmlSourceWithinNormalizationBudget(source: string, limit: number): boolean {
  return source.length <= limit && estimateNormalizedXhtmlSourceLength(source) <= limit;
}

function stripIllegalXmlChars(source: string): string {
  return source.replace(ILLEGAL_XML_CHARS_RE, '');
}

/** Whether a Unicode code point is a legal XML 1.0 character. */
function isValidXmlChar(codePoint: number): boolean {
  return (
    codePoint === 0x9 ||
    codePoint === 0xa ||
    codePoint === 0xd ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  );
}

function normalizeXmlDeclaration(source: string): string {
  return source.replace(XML_DECLARATION_RE, (_match, bom: string, attributes: string) => {
    const normalizedAttributes = attributes.replace(
      SINGLE_QUOTED_XML_DECLARATION_ATTRIBUTE_RE,
      (_attribute, name: string, value: string) => `${name}="${value}"`,
    );
    return `${bom}<?xml ${normalizedAttributes}?>`;
  });
}

function normalizeAmpersandsOutsidePreserved(source: string): string {
  let result = '';
  let lastIndex = 0;
  for (const match of source.matchAll(PRESERVED_REGION_RE)) {
    const start = match.index;
    result += normalizeAmpersands(source.slice(lastIndex, start));
    result += match[0]; // comment / CDATA — left untouched
    lastIndex = start + match[0].length;
  }
  return result + normalizeAmpersands(source.slice(lastIndex));
}

function normalizeAmpersands(source: string): string {
  return source.replace(AMPERSAND_RE, normalizeAmpersand);
}

function normalizedAmpersandLengthDelta(source: string): number {
  let delta = 0;
  for (const match of source.matchAll(AMPERSAND_RE)) {
    const replacement = normalizeAmpersand(match[0], match[1]);
    delta += replacement.length - match[0].length;
  }
  return delta;
}

function normalizeAmpersand(match: string, body: string | undefined): string {
  // Bare `&` not followed by any entity-like token (e.g. `A & B`).
  if (body === undefined) return '&amp;';
  // Numeric character reference — keep it, but drop refs to illegal chars
  // (e.g. `&#31;` / `&#x1F;`) that would otherwise abort the parse.
  if (body.startsWith('#')) {
    const hex = body[1] === 'x' || body[1] === 'X';
    const codePoint = Number.parseInt(body.slice(hex ? 2 : 1, -1), hex ? 16 : 10);
    return isValidXmlChar(codePoint) ? match : '';
  }
  // Named token: `name;` → strip the trailing `;` to look up.
  const name = body.slice(0, -1);
  if (XML_PREDEFINED.has(name)) return match;
  const codePoint = HTML_NAMED_ENTITIES[name];
  if (codePoint !== undefined) return `&#${String(codePoint)};`;
  // Unknown named entity (e.g. `&foo;`): escape the `&` so the literal
  // text survives instead of aborting the parse.
  return `&amp;${body}`;
}
