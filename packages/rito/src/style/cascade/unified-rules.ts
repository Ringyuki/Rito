import type { ComputedStyle, CssRule, Specificity } from '../core/types';
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
}

/** Inline style specificity - higher than any selector. */
const INLINE_SPECIFICITY: Specificity = [Infinity, 0, 0];

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
  viewport?: Viewport,
): ComputedStyle {
  const matches = collectMatchedRules(
    target,
    rules,
    index,
    ancestors,
    inlineCss,
    parentFontSize,
    viewport,
  );
  if (matches.length === 0) return style;
  matches.sort((a, b) => compareSpecificity(a.specificity, b.specificity));

  const resolvedFontSize = resolveFinalFontSize(style.fontSize, matches, parentFontSize, viewport);
  return applyMatchedRules(style, matches, resolvedFontSize, viewport);
}

function collectMatchedRules(
  target: SelectorTarget,
  rules: readonly CssRule[] | undefined,
  index: RuleIndex | undefined,
  ancestors: readonly SelectorTarget[],
  inlineCss: string | undefined,
  parentFontSize: number,
  viewport: Viewport | undefined,
): MatchedRule[] {
  const matches: MatchedRule[] = [];
  for (const rule of getRuleCandidates(target, rules, index)) {
    if (matchesSelector(target, rule.selector, ancestors)) {
      matches.push(toMatchedRule(rule));
    }
  }
  if (inlineCss) {
    matches.push(createInlineRule(inlineCss, parentFontSize, viewport));
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
  };
}

function createInlineRule(
  inlineCss: string,
  parentFontSize: number,
  viewport: Viewport | undefined,
): MatchedRule {
  return {
    rawDeclarations: inlineCss,
    declarations: parseCssDeclarations(inlineCss, parentFontSize, parentFontSize, viewport),
    specificity: INLINE_SPECIFICITY,
  };
}

function resolveFinalFontSize(
  initialFontSize: number,
  matches: readonly MatchedRule[],
  parentFontSize: number,
  viewport: Viewport | undefined,
): number {
  let resolvedFontSize = initialFontSize;
  for (const match of matches) {
    const reparsed = parseCssDeclarations(
      match.rawDeclarations,
      parentFontSize,
      parentFontSize,
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
  viewport: Viewport | undefined,
): ComputedStyle {
  let result: ComputedStyle = { ...style, fontSize: resolvedFontSize };
  for (const match of matches) {
    const resolved = parseCssDeclarations(
      match.rawDeclarations,
      resolvedFontSize,
      resolvedFontSize,
      viewport,
    );
    result = { ...result, ...resolved, fontSize: resolvedFontSize };
  }
  return result;
}
