const CONTENT_RE = /(?:^|;\s*)content\s*:\s*(.+?)(?:\s*!important\s*)?(?:;|$)/i;
const STRING_RE = /(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)')/g;
const UNICODE_ESCAPE_RE = /\\([0-9a-fA-F]{1,6})\s?/g;

/**
 * Extract and parse the CSS `content` property from a raw declaration block.
 *
 * Returns:
 * - `undefined` if no `content` declaration exists
 * - `null` if `content` is `none` or `normal`
 * - The resolved text string otherwise (may be empty `""`)
 */
export function parseContentValue(rawDeclarations: string): string | null | undefined {
  const match = CONTENT_RE.exec(rawDeclarations);
  if (!match?.[1]) return undefined;

  const value = match[1].trim();
  if (value === 'none' || value === 'normal') return null;

  // Concatenate all quoted strings: content: "foo" "bar" → "foobar"
  let result = '';
  let found = false;
  STRING_RE.lastIndex = 0;

  let stringMatch = STRING_RE.exec(value);
  while (stringMatch) {
    found = true;
    const raw = stringMatch[1] ?? stringMatch[2] ?? '';
    result += resolveEscapes(raw);
    stringMatch = STRING_RE.exec(value);
  }

  return found ? result : undefined;
}

function resolveEscapes(raw: string): string {
  return raw.replace(UNICODE_ESCAPE_RE, (_, hex: string) =>
    String.fromCodePoint(parseInt(hex, 16)),
  );
}
