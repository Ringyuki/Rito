const SELECTOR_TOKEN_RE = /[#.]?[a-zA-Z][a-zA-Z0-9_-]*/g;
// Matches [attr], [attr=val], [attr="val"], [attr='val'], and operator variants (~=, |=, ^=, $=, *=)
const ATTR_SELECTOR_RE =
  /\[([a-zA-Z][a-zA-Z0-9:_-]*)(?:([~|^$*]?=)(?:"([^"]*)"|'([^']*)'|([^\]"'\s]*)))?\]/g;

/** Data needed to match a node against CSS selectors. */
export interface SelectorTarget {
  readonly tag: string;
  readonly className?: string;
  readonly id?: string;
  /** All HTML attributes for attribute selector matching (e.g. [epub:type], [role]). */
  readonly attributes?: ReadonlyMap<string, string>;
}

type Combinator = 'descendant' | 'child';

interface SelectorPart {
  compound: string;
  combinator: Combinator;
}

/**
 * Check whether a target matches a CSS selector.
 * Supports: element, class, id, compound, descendant (` `), and child (`>`) selectors.
 * Examples: `p`, `.intro`, `#ch1`, `p.intro`, `.title p`, `ul > li`, `body .content > p`
 *
 * @param ancestors - Ordered from immediate parent to root (optional).
 */
export function matchesSelector(
  target: SelectorTarget,
  selector: string,
  ancestors?: readonly SelectorTarget[],
): boolean {
  const parts = parseSelectorParts(selector);
  if (parts.length === 0) return false;

  // Last part must match the target node
  const lastPart = parts[parts.length - 1];
  if (!lastPart || !matchesCompound(target, lastPart.compound)) return false;

  // Single-part selector: done
  if (parts.length === 1) return true;

  // Multi-part: check ancestors for preceding parts
  if (!ancestors || ancestors.length === 0) return false;
  return matchesAncestorChain(parts.slice(0, -1), lastPart.combinator, ancestors);
}

/**
 * Parse a selector into compound parts with their combinators.
 * Bracket-aware: spaces inside `[...]` (e.g. `[title="foo bar"]`) are preserved.
 */
function parseSelectorParts(selector: string): SelectorPart[] {
  const tokens = bracketAwareSplit(selector.trim());
  const result: SelectorPart[] = [];
  let nextCombinator: Combinator = 'descendant';
  for (const token of tokens) {
    if (token === '>') {
      nextCombinator = 'child';
    } else {
      result.push({ compound: token, combinator: nextCombinator });
      nextCombinator = 'descendant';
    }
  }
  return result;
}

/** Split a selector on whitespace and `>`, preserving content inside `[...]` brackets. */
function bracketAwareSplit(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let bracketDepth = 0;
  let quoteChar = '';

  for (let i = 0; i < input.length; i++) {
    const ch = input.charAt(i);
    if (bracketDepth > 0 && quoteChar === '' && (ch === '"' || ch === "'")) {
      quoteChar = ch;
      current += ch;
      continue;
    }
    if (quoteChar !== '' && ch === quoteChar) {
      quoteChar = '';
      current += ch;
      continue;
    }
    if (ch === '[') {
      bracketDepth++;
      current += ch;
      continue;
    }
    if (ch === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      current += ch;
      continue;
    }
    if (bracketDepth > 0 || quoteChar !== '') {
      current += ch;
      continue;
    }

    if (ch === '>') {
      if (current.trim()) {
        tokens.push(current.trim());
        current = '';
      }
      tokens.push('>');
    } else if (ch === ' ' || ch === '\t' || ch === '\n') {
      if (current.trim()) {
        tokens.push(current.trim());
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

/** Match a single compound selector (no spaces) against a target. */
function matchesCompound(target: SelectorTarget, compound: string): boolean {
  // Strip attribute selectors before matching tag/class/id tokens
  const withoutAttrs = compound.replace(ATTR_SELECTOR_RE, '');
  const tokens = withoutAttrs.match(SELECTOR_TOKEN_RE);

  // A compound may be purely attribute-based, e.g. [epub:type="toc"]
  if ((!tokens || tokens.length === 0) && !compound.includes('[')) return false;

  const nodeClasses: string[] = target.className?.split(/\s+/) ?? [];

  if (tokens) {
    for (const token of tokens) {
      if (token.startsWith('#')) {
        if (target.id !== token.slice(1)) return false;
      } else if (token.startsWith('.')) {
        if (!nodeClasses.includes(token.slice(1))) return false;
      } else {
        if (target.tag !== token) return false;
      }
    }
  }

  // Match attribute selectors
  if (compound.includes('[')) {
    if (!matchesAttributeSelectors(target, compound)) return false;
  }

  return true;
}

function matchesAttributeSelectors(target: SelectorTarget, compound: string): boolean {
  ATTR_SELECTOR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_SELECTOR_RE.exec(compound)) !== null) {
    const attrName = match[1];
    const operator = match[2];
    // Value can be in group 3 (double-quoted), 4 (single-quoted), or 5 (unquoted)
    const attrValue = match[3] ?? match[4] ?? match[5];
    if (!attrName) continue;

    const actual = target.attributes?.get(attrName);

    if (operator === undefined) {
      // [attr] — existence check
      if (actual === undefined) return false;
    } else if (operator === '=') {
      // [attr="val"] — exact match
      if (actual !== attrValue) return false;
    } else if (operator === '~=') {
      // [attr~="val"] — whitespace-separated word match
      if (actual === undefined || !actual.split(/\s+/).includes(attrValue ?? '')) return false;
    } else if (operator === '|=') {
      // [attr|="val"] — exact or prefix with hyphen
      if (actual === undefined) return false;
      if (actual !== attrValue && !actual.startsWith((attrValue ?? '') + '-')) return false;
    } else if (operator === '^=') {
      // [attr^="val"] — starts with
      if (actual === undefined || !actual.startsWith(attrValue ?? '')) return false;
    } else if (operator === '$=') {
      // [attr$="val"] — ends with
      if (actual === undefined || !actual.endsWith(attrValue ?? '')) return false;
    } else if (operator === '*=') {
      // [attr*="val"] — contains
      if (actual === undefined || !actual.includes(attrValue ?? '')) return false;
    }
  }
  return true;
}

/**
 * Check if ancestor selector parts can be satisfied by the ancestor chain.
 * Each part uses its combinator to determine matching mode:
 * - descendant: can skip ancestors (search forward)
 * - child: must match the immediate next ancestor
 *
 * @param innermostCombinator - The combinator between the last checked part and the target
 */
function matchesAncestorChain(
  parts: readonly SelectorPart[],
  innermostCombinator: Combinator,
  ancestors: readonly SelectorTarget[],
): boolean {
  let ancestorIdx = 0;
  let currentCombinator = innermostCombinator;

  // Walk parts right-to-left (innermost ancestor first)
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (!part) return false;

    if (currentCombinator === 'child') {
      // Must match the immediate ancestor
      const ancestor = ancestors[ancestorIdx];
      if (!ancestor || !matchesCompound(ancestor, part.compound)) return false;
      ancestorIdx++;
    } else {
      // Descendant: search forward through ancestors
      let found = false;
      while (ancestorIdx < ancestors.length) {
        const ancestor = ancestors[ancestorIdx];
        ancestorIdx++;
        if (ancestor && matchesCompound(ancestor, part.compound)) {
          found = true;
          break;
        }
      }
      if (!found) return false;
    }

    currentCombinator = part.combinator;
  }
  return true;
}
