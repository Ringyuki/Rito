/** Parse a CSS length value (px, pt, em, %) to a number in px. */
export function parseLength(value: string, parentFontSize: number): number | undefined {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.endsWith('px')) return parseFloat(trimmed);
  if (trimmed.endsWith('pt')) return parseFloat(trimmed) * (4 / 3);
  if (trimmed.endsWith('em')) return parseFloat(trimmed) * parentFontSize;
  if (trimmed.endsWith('%')) return (parseFloat(trimmed) / 100) * parentFontSize;
  const num = parseFloat(trimmed);
  if (!isNaN(num) && /^\d/.test(trimmed)) return num;
  return undefined;
}

/**
 * Apply a CSS box shorthand (margin or padding) to the result object.
 * Handles 1-4 value patterns: all / TB+LR / T+LR+B / T+R+B+L
 */
export function applyBoxShorthand(
  result: Record<string, unknown>,
  value: string,
  parentFontSize: number,
  keys: readonly [string, string, string, string],
): void {
  const parts = value.trim().split(/\s+/);
  const values = parts.map((p) => parseLength(p, parentFontSize));
  const [top, right, bottom, left] = keys;

  if (parts.length === 1 && values[0] !== undefined) {
    result[top] = values[0];
    result[right] = values[0];
    result[bottom] = values[0];
    result[left] = values[0];
  } else if (parts.length === 2) {
    if (values[0] !== undefined) {
      result[top] = values[0];
      result[bottom] = values[0];
    }
    if (values[1] !== undefined) {
      result[right] = values[1];
      result[left] = values[1];
    }
  } else if (parts.length === 3) {
    if (values[0] !== undefined) result[top] = values[0];
    if (values[1] !== undefined) {
      result[right] = values[1];
      result[left] = values[1];
    }
    if (values[2] !== undefined) result[bottom] = values[2];
  } else if (parts.length >= 4) {
    if (values[0] !== undefined) result[top] = values[0];
    if (values[1] !== undefined) result[right] = values[1];
    if (values[2] !== undefined) result[bottom] = values[2];
    if (values[3] !== undefined) result[left] = values[3];
  }
}
