import type { CssRule } from '../style/core/types';
import { parseCssRules } from '../style/css/rule-parser';

export function buildStylesheetRules(
  stylesheets: ReadonlyMap<string, string>,
  rootFontSize: number,
): CssRule[] {
  const rules: CssRule[] = [];
  for (const css of stylesheets.values()) rules.push(...parseCssRules(css, rootFontSize));
  return rules;
}

export function buildStylesheetRuleMap(
  stylesheets: ReadonlyMap<string, string>,
  rootFontSize: number,
): ReadonlyMap<string, readonly CssRule[]> {
  const map = new Map<string, readonly CssRule[]>();
  for (const [href, css] of stylesheets) map.set(href, parseCssRules(css, rootFontSize));
  return map;
}

export function buildChapterRules(
  allRules: readonly CssRule[],
  rulesByStylesheet: ReadonlyMap<string, readonly CssRule[]>,
  linkHrefs: readonly string[] | undefined,
  embedded: readonly string[] | undefined,
  rootFontSize: number,
): readonly CssRule[] {
  const linked = linkHrefs ? filterRulesByChapterHrefs(rulesByStylesheet, linkHrefs) : allRules;
  if (!embedded || embedded.length === 0) return linked;
  const result = [...linked];
  for (const css of embedded) result.push(...parseCssRules(css, rootFontSize));
  return result;
}

function filterRulesByChapterHrefs(
  rulesByStylesheet: ReadonlyMap<string, readonly CssRule[]>,
  linkHrefs: readonly string[],
): readonly CssRule[] {
  const rules: CssRule[] = [];
  const stylesheetKeys = [...rulesByStylesheet.keys()];
  for (const linkHref of linkHrefs) {
    const matchingKeys = findMatchingStylesheetKeys(stylesheetKeys, linkHref);
    // A suffix collision is genuinely ambiguous without the chapter's href.
    // Never bind it to arbitrary Map insertion order.
    if (matchingKeys.length === 1) {
      rules.push(...(rulesByStylesheet.get(matchingKeys[0] ?? '') ?? []));
    }
  }
  return rules;
}

function findMatchingStylesheetKeys(keys: readonly string[], linkHref: string): string[] {
  const link = normalizeStylesheetHref(linkHref);
  const withoutParents = link.replace(/^(?:\.\.\/)+/, '');
  const exact = keys.filter((key) => {
    const normalizedKey = normalizeStylesheetHref(key);
    return normalizedKey === link || normalizedKey === withoutParents;
  });
  if (exact.length > 0) return exact;
  return keys.filter((key) => {
    const normalizedKey = normalizeStylesheetHref(key);
    return (
      normalizedKey.endsWith('/' + withoutParents) || withoutParents.endsWith('/' + normalizedKey)
    );
  });
}

function normalizeStylesheetHref(href: string): string {
  const clean = href.split(/[?#]/, 1)[0] ?? href;
  let decoded: string;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    return '';
  }
  const parts: string[] = [];
  for (const part of decoded.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..' && parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}
