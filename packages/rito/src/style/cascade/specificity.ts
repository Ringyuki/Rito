import type { Specificity } from '../core/types';

const SELECTOR_TOKEN_RE = /[#.]?[a-zA-Z][a-zA-Z0-9_-]*/g;
// Matches [...] including quoted values that may contain `]`
const ATTR_SELECTOR_COUNT_RE = /\[(?:[^\]"']*(?:"[^"]*"|'[^']*')?)*\]/g;

/** Calculate CSS specificity for a selector (supports descendant, child, and attribute selectors). */
export function calculateSpecificity(selector: string): Specificity {
  // Count attribute selectors (each counts as one class-level specificity)
  const attrCount = (selector.match(ATTR_SELECTOR_COUNT_RE) ?? []).length;

  // Strip combinators and attribute selectors, then count remaining tokens
  const stripped = selector.replace(/\s*>\s*/g, ' ').replace(ATTR_SELECTOR_COUNT_RE, '');
  const tokens = stripped.match(SELECTOR_TOKEN_RE) ?? [];
  let ids = 0;
  let classes = attrCount;
  let elements = 0;

  for (const token of tokens) {
    if (token.startsWith('#')) ids++;
    else if (token.startsWith('.')) classes++;
    else elements++;
  }

  return [ids, classes, elements] as const;
}

/** Compare two specificity values. Returns negative if a < b, 0 if equal, positive if a > b. */
export function compareSpecificity(a: Specificity, b: Specificity): number {
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
