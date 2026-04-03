/**
 * Collapse whitespace in a text string according to normal HTML whitespace rules.
 * Consecutive whitespace characters (spaces, tabs, newlines) are collapsed to a single space.
 */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/**
 * Check if a string is entirely whitespace.
 */
export function isWhitespaceOnly(text: string): boolean {
  return /^\s*$/.test(text);
}
