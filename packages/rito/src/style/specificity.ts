import type { Specificity } from './types';

const SELECTOR_TOKEN_RE = /[#.]?[a-zA-Z][a-zA-Z0-9_-]*/g;

/** Calculate CSS specificity for a simple or compound selector. */
export function calculateSpecificity(selector: string): Specificity {
  const tokens = selector.match(SELECTOR_TOKEN_RE) ?? [];
  let ids = 0;
  let classes = 0;
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
