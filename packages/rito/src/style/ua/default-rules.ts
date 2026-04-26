import type { CssRule } from '../core/types';
import { DEFAULT_STYLE } from '../core/defaults';
import { parseCssRules } from '../css/rule-parser';
import { DEFAULT_UA_STYLESHEET } from './default-stylesheet';

export const DEFAULT_UA_RULES = parseCssRules(DEFAULT_UA_STYLESHEET, DEFAULT_STYLE.fontSize, {
  origin: 'ua',
});

export function withDefaultUaRules(rules?: readonly CssRule[]): readonly CssRule[] {
  if (!rules || rules.length === 0) return DEFAULT_UA_RULES;
  return [...DEFAULT_UA_RULES, ...rules];
}
