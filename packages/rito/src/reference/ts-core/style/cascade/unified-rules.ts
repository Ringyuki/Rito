import type { ComputedStyle, CssRule, CssRuleOrigin, Specificity } from '../core/types';
import { parseCssDeclarations } from '../css/property-parser';
import type { Viewport } from '../css/parse-utils';
import type { RuleIndex } from './rule-index';
import type { SelectorTarget } from './selector-matcher';
import { matchesSelector } from './selector-matcher';
import { calculateSpecificity, compareSpecificity } from './specificity';

interface MatchedRule {
  readonly rawDeclarations: string;
  readonly declarations: Partial<ComputedStyle>;
  readonly specificity: Specificity;
  readonly origin: CascadeOrigin;
}

type CascadeOrigin = CssRuleOrigin | 'inline';

/** Inline style specificity - higher than any selector. */
const INLINE_SPECIFICITY: Specificity = [Infinity, 0, 0];
const ORIGIN_RANK: Readonly<Record<CascadeOrigin, number>> = {
  ua: 0,
  author: 1,
  inline: 2,
};

/**
 * Unified cascade: stylesheet rules + inline style resolved together.
 *
 * `font-size` em values resolve against the parent font-size; other em values
 * resolve against the element's final font-size, so declarations are parsed in
 * two passes.
 */
export function applyUnifiedRules(
  style: ComputedStyle,
  target: SelectorTarget,
  parentFontSize: number,
  rules: readonly CssRule[] | undefined,
  index: RuleIndex | undefined,
  ancestors: readonly SelectorTarget[],
  inlineCss: string | undefined,
  rootFontSize: number,
  viewport?: Viewport,
): ComputedStyle {
  const matches = collectMatchedRules(
    target,
    rules,
    index,
    ancestors,
    inlineCss,
    parentFontSize,
    rootFontSize,
    viewport,
  );
  if (matches.length === 0) return style;
  matches.sort(compareMatchedRules);

  const resolvedFontSize = resolveFinalFontSize(
    style.fontSize,
    matches,
    parentFontSize,
    rootFontSize,
    viewport,
  );
  return applyMatchedRules(style, matches, resolvedFontSize, rootFontSize, viewport);
}

function collectMatchedRules(
  target: SelectorTarget,
  rules: readonly CssRule[] | undefined,
  index: RuleIndex | undefined,
  ancestors: readonly SelectorTarget[],
  inlineCss: string | undefined,
  parentFontSize: number,
  rootFontSize: number,
  viewport: Viewport | undefined,
): MatchedRule[] {
  const matches: MatchedRule[] = [];
  for (const rule of getRuleCandidates(target, rules, index)) {
    if (matchesSelector(target, rule.selector, ancestors)) {
      matches.push(toMatchedRule(rule));
    }
  }
  if (inlineCss) {
    matches.push(createInlineRule(inlineCss, parentFontSize, rootFontSize, viewport));
  }
  return matches;
}

function getRuleCandidates(
  target: SelectorTarget,
  rules: readonly CssRule[] | undefined,
  index: RuleIndex | undefined,
): readonly CssRule[] {
  if (!rules || rules.length === 0) return [];
  return index ? index.getCandidates(target.tag, target.className, target.id) : rules;
}

function toMatchedRule(rule: CssRule): MatchedRule {
  return {
    rawDeclarations: rule.rawDeclarations,
    declarations: rule.declarations,
    specificity: calculateSpecificity(rule.selector),
    origin: rule.origin ?? 'author',
  };
}

function createInlineRule(
  inlineCss: string,
  parentFontSize: number,
  rootFontSize: number,
  viewport: Viewport | undefined,
): MatchedRule {
  return {
    rawDeclarations: inlineCss,
    declarations: parseCssDeclarations(inlineCss, parentFontSize, rootFontSize, viewport),
    specificity: INLINE_SPECIFICITY,
    origin: 'inline',
  };
}

function compareMatchedRules(a: MatchedRule, b: MatchedRule): number {
  const originDiff = ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin];
  if (originDiff !== 0) return originDiff;
  return compareSpecificity(a.specificity, b.specificity);
}

function resolveFinalFontSize(
  initialFontSize: number,
  matches: readonly MatchedRule[],
  parentFontSize: number,
  rootFontSize: number,
  viewport: Viewport | undefined,
): number {
  let resolvedFontSize = initialFontSize;
  for (const match of matches) {
    const reparsed = parseCssDeclarations(
      match.rawDeclarations,
      parentFontSize,
      rootFontSize,
      viewport,
    );
    if (reparsed.fontSize !== undefined) resolvedFontSize = reparsed.fontSize;
  }
  return resolvedFontSize;
}

function applyMatchedRules(
  style: ComputedStyle,
  matches: readonly MatchedRule[],
  resolvedFontSize: number,
  rootFontSize: number,
  viewport: Viewport | undefined,
): ComputedStyle {
  let result: ComputedStyle = { ...style, fontSize: resolvedFontSize };
  for (const match of matches) {
    const resolved = parseCssDeclarations(
      match.rawDeclarations,
      resolvedFontSize,
      rootFontSize,
      viewport,
    );
    result = { ...result, ...resolved, fontSize: resolvedFontSize };
  }
  return result;
}
