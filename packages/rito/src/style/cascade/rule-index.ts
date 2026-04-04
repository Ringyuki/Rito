import type { CssRule } from '../core/types';

/**
 * Pre-indexed CSS rules for fast lookup by tag, class, or id.
 *
 * Instead of testing every rule against every node (O(rules × nodes)),
 * this index allows O(1) lookup of candidate rules by the node's tag,
 * class names, and id. Only candidate rules need full selector matching.
 */
export interface RuleIndex {
  /** Get candidate rules that may match a node with the given tag, classes, and id. */
  getCandidates(
    tag: string,
    className: string | undefined,
    id: string | undefined,
  ): readonly CssRule[];
}

/**
 * Build a rule index from a list of CSS rules.
 *
 * Each rule is indexed by the simple selectors in its last compound selector
 * (the part that must match the target node). Rules with only descendant
 * selectors are indexed by the rightmost part.
 */
export function buildRuleIndex(rules: readonly CssRule[]): RuleIndex {
  const byTag = new Map<string, CssRule[]>();
  const byClass = new Map<string, CssRule[]>();
  const byId = new Map<string, CssRule[]>();
  const universal: CssRule[] = [];

  for (const rule of rules) {
    const keys = extractIndexKeys(rule.selector);
    if (keys.tags.length === 0 && keys.classes.length === 0 && keys.ids.length === 0) {
      universal.push(rule);
      continue;
    }
    for (const tag of keys.tags) addTo(byTag, tag, rule);
    for (const cls of keys.classes) addTo(byClass, cls, rule);
    for (const id of keys.ids) addTo(byId, id, rule);
  }

  return {
    getCandidates(tag, className, id) {
      const result = new Set<CssRule>();
      const tagRules = byTag.get(tag);
      if (tagRules) for (const r of tagRules) result.add(r);

      if (className) {
        for (const cls of className.split(/\s+/)) {
          const classRules = byClass.get(cls);
          if (classRules) for (const r of classRules) result.add(r);
        }
      }

      if (id) {
        const idRules = byId.get(id);
        if (idRules) for (const r of idRules) result.add(r);
      }

      for (const r of universal) result.add(r);
      return Array.from(result);
    },
  };
}

interface IndexKeys {
  tags: string[];
  classes: string[];
  ids: string[];
}

/** Extract the simple selector keys from the last compound part of a selector. */
function extractIndexKeys(selector: string): IndexKeys {
  const parts = selector.trim().split(/\s+/);
  const last = parts[parts.length - 1] ?? '';
  const tokens = last.match(/[#.]?[a-zA-Z][a-zA-Z0-9_-]*/g) ?? [];

  const tags: string[] = [];
  const classes: string[] = [];
  const ids: string[] = [];

  for (const token of tokens) {
    if (token.startsWith('#')) ids.push(token.slice(1));
    else if (token.startsWith('.')) classes.push(token.slice(1));
    else tags.push(token);
  }

  return { tags, classes, ids };
}

function addTo(map: Map<string, CssRule[]>, key: string, rule: CssRule): void {
  let arr = map.get(key);
  if (!arr) {
    arr = [];
    map.set(key, arr);
  }
  arr.push(rule);
}
