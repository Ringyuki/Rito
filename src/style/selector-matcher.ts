const SELECTOR_TOKEN_RE = /[#.]?[a-zA-Z][a-zA-Z0-9_-]*/g;

/** Data needed to match a node against CSS selectors. */
export interface SelectorTarget {
  readonly tag: string;
  readonly className?: string;
  readonly id?: string;
}

/**
 * Check whether a target matches a CSS selector.
 * Supports: element, class, id, compound, and descendant selectors.
 * Examples: `p`, `.intro`, `#ch1`, `p.intro`, `.title p`, `body .content p`
 *
 * @param ancestors - Ordered from immediate parent to root (optional).
 */
export function matchesSelector(
  target: SelectorTarget,
  selector: string,
  ancestors?: readonly SelectorTarget[],
): boolean {
  const parts = selector.trim().split(/\s+/);
  if (parts.length === 0) return false;

  // Last part must match the target node
  const lastPart = parts[parts.length - 1];
  if (!lastPart || !matchesCompound(target, lastPart)) return false;

  // Single-part selector: done
  if (parts.length === 1) return true;

  // Multi-part: check ancestors for preceding parts (descendant combinator)
  if (!ancestors || ancestors.length === 0) return false;
  return matchesAncestorChain(parts.slice(0, -1), ancestors);
}

/** Match a single compound selector (no spaces) against a target. */
function matchesCompound(target: SelectorTarget, compound: string): boolean {
  const tokens = compound.match(SELECTOR_TOKEN_RE);
  if (!tokens || tokens.length === 0) return false;

  const nodeClasses: string[] = target.className?.split(/\s+/) ?? [];

  for (const token of tokens) {
    if (token.startsWith('#')) {
      if (target.id !== token.slice(1)) return false;
    } else if (token.startsWith('.')) {
      if (!nodeClasses.includes(token.slice(1))) return false;
    } else {
      if (target.tag !== token) return false;
    }
  }

  return true;
}

/**
 * Check if ancestor selector parts can be satisfied by the ancestor chain.
 * Each part must match some ancestor, and the order must be maintained
 * (each subsequent part must match an ancestor closer to the root).
 */
function matchesAncestorChain(parts: string[], ancestors: readonly SelectorTarget[]): boolean {
  let ancestorIdx = 0;
  // Walk parts right-to-left (innermost ancestor first)
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (!part) return false;

    let found = false;
    while (ancestorIdx < ancestors.length) {
      const ancestor = ancestors[ancestorIdx];
      ancestorIdx++;
      if (ancestor && matchesCompound(ancestor, part)) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}
