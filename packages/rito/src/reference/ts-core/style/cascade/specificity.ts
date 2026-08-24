import type { Specificity } from '../core/types';

const SELECTOR_TOKEN_RE = /[#.]?[a-zA-Z][a-zA-Z0-9_-]*/g;
// Matches [...] including quoted values that may contain `]`
const ATTR_SELECTOR_COUNT_RE = /\[(?:[^\]"']*(?:"[^"]*"|'[^']*')?)*\]/g;
const PSEUDO_CLASS_COUNT_RE = /:(?:first-child|last-child)/g;
const PSEUDO_ELEMENT_RE = /::?(?:before|after)$/i;

/** Calculate CSS specificity for a selector. */
export function calculateSpecificity(selector: string): Specificity {
  // Pseudo-elements contribute (0,0,1) per CSS spec
  const hasPseudoElement = PSEUDO_ELEMENT_RE.test(selector);
  const base = selector.replace(PSEUDO_ELEMENT_RE, '');

  // Count attribute selectors and pseudo-classes (each counts as class-level specificity)
  const attrCount = (base.match(ATTR_SELECTOR_COUNT_RE) ?? []).length;
  const pseudoCount = (base.match(PSEUDO_CLASS_COUNT_RE) ?? []).length;

  // Strip combinators, attribute selectors, and pseudo-classes, then count remaining tokens
  const stripped = base
    .replace(/\s*[>+]\s*/g, ' ')
    .replace(ATTR_SELECTOR_COUNT_RE, '')
    .replace(PSEUDO_CLASS_COUNT_RE, '');
  const tokens = stripped.match(SELECTOR_TOKEN_RE) ?? [];
  let ids = 0;
  let classes = attrCount + pseudoCount;
  let elements = hasPseudoElement ? 1 : 0;

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
