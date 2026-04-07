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
  /** The immediately preceding element sibling (for `+` combinator matching). */
  readonly previousSibling?: SelectorTarget;
  /** 0-based index among element siblings (for :first-child / :last-child). */
  readonly siblingIndex?: number;
  /** Total element sibling count in parent (for :last-child). */
  readonly siblingCount?: number;
}

type Combinator = 'descendant' | 'child' | 'adjacent-sibling';

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

  // Multi-part: resolve the remaining chain
  return matchesChain(parts.slice(0, -1), lastPart.combinator, target, ancestors ?? []);
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
    } else if (token === '+') {
      nextCombinator = 'adjacent-sibling';
    } else {
      result.push({ compound: token, combinator: nextCombinator });
      nextCombinator = 'descendant';
    }
  }
  return result;
}

/** Split a selector on whitespace, `>` and `+`, preserving content inside `[...]` brackets. */
function bracketAwareSplit(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let depth = 0;
  let quote = '';

  for (let i = 0; i < input.length; i++) {
    const ch = input.charAt(i);
    // Track quotes inside brackets
    if (depth > 0 && quote === '' && (ch === '"' || ch === "'")) {
      quote = ch;
      current += ch;
      continue;
    }
    if (quote !== '' && ch === quote) {
      quote = '';
      current += ch;
      continue;
    }
    if (ch === '[') {
      depth++;
      current += ch;
      continue;
    }
    if (ch === ']') {
      depth = Math.max(0, depth - 1);
      current += ch;
      continue;
    }
    if (depth > 0 || quote !== '') {
      current += ch;
      continue;
    }
    // Outside brackets: split on combinators and whitespace
    if (ch === '>' || ch === '+') {
      if (current.trim()) {
        tokens.push(current.trim());
        current = '';
      }
      tokens.push(ch);
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

const PSEUDO_CLASS_RE = /:(?:first-child|last-child)/g;

/** Match a single compound selector (no spaces) against a target. */
function matchesCompound(target: SelectorTarget, compound: string): boolean {
  // Check pseudo-classes before stripping them
  if (compound.includes(':first-child') && target.siblingIndex !== 0) return false;
  if (compound.includes(':last-child')) {
    if (target.siblingIndex === undefined || target.siblingCount === undefined) return false;
    if (target.siblingIndex !== target.siblingCount - 1) return false;
  }

  // Strip attribute selectors and pseudo-classes before matching tag/class/id tokens
  const withoutAttrs = compound.replace(ATTR_SELECTOR_RE, '').replace(PSEUDO_CLASS_RE, '');
  const tokens = withoutAttrs.match(SELECTOR_TOKEN_RE);

  // A compound may be purely attribute-based or pseudo-class-only
  if ((!tokens || tokens.length === 0) && !compound.includes('[') && !compound.includes(':'))
    return false;

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
    if (!attrName) continue;
    const operator = match[2];
    const attrValue = match[3] ?? match[4] ?? match[5];
    const actual = target.attributes?.get(attrName);
    if (!matchesAttrOperator(actual, operator, attrValue)) return false;
  }
  return true;
}

function matchesAttrOperator(
  actual: string | undefined,
  operator: string | undefined,
  expected: string | undefined,
): boolean {
  if (operator === undefined) return actual !== undefined;
  if (actual === undefined) return false;
  const val = expected ?? '';
  if (operator === '=') return actual === val;
  if (operator === '~=') return actual.split(/\s+/).includes(val);
  if (operator === '|=') return actual === val || actual.startsWith(val + '-');
  if (operator === '^=') return actual.startsWith(val);
  if (operator === '$=') return actual.endsWith(val);
  if (operator === '*=') return actual.includes(val);
  return false;
}

/**
 * Resolve the selector chain walking right-to-left.
 * - descendant: search forward through ancestors
 * - child: must match immediate parent (ancestors[0])
 * - adjacent-sibling: must match the current node's previousSibling
 *
 * @param innermostCombinator - The combinator between the rightmost remaining part and the matched node
 * @param matchedNode - The node that was just matched (target or a previousSibling)
 */
function matchesChain(
  parts: readonly SelectorPart[],
  innermostCombinator: Combinator,
  matchedNode: SelectorTarget,
  ancestors: readonly SelectorTarget[],
): boolean {
  let ancestorIdx = 0;
  let currentCombinator = innermostCombinator;
  let currentNode = matchedNode;

  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (!part) return false;

    if (currentCombinator === 'adjacent-sibling') {
      const prev = currentNode.previousSibling;
      if (!prev || !matchesCompound(prev, part.compound)) return false;
      currentNode = prev;
    } else if (currentCombinator === 'child') {
      const ancestor = ancestors[ancestorIdx];
      if (!ancestor || !matchesCompound(ancestor, part.compound)) return false;
      currentNode = ancestor;
      ancestorIdx++;
    } else {
      let found = false;
      while (ancestorIdx < ancestors.length) {
        const ancestor = ancestors[ancestorIdx];
        ancestorIdx++;
        if (ancestor && matchesCompound(ancestor, part.compound)) {
          currentNode = ancestor;
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
