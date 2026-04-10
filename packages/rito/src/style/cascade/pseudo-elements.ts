import { inheritableStyle } from '../core/defaults';
import { DISPLAY_VALUES, type ComputedStyle, type CssRule, type Specificity } from '../core/types';
import type { StyledNode } from '../core/types';
import { parseCssDeclarations } from '../css/property-parser';
import { parseContentValue } from '../css/property-handlers/content-handler';
import type { RuleIndex } from './rule-index';
import type { SelectorTarget } from './selector-matcher';
import { extractPseudoElement, matchesSelector, stripPseudoElement } from './selector-matcher';
import { calculateSpecificity, compareSpecificity } from './specificity';

/**
 * Inject synthetic ::before / ::after StyledNodes into a resolved children array.
 *
 * Pseudo-element nodes inherit from the parent element's style, then apply
 * their own CSS declarations. If no matching pseudo-element rules exist
 * (or content is none/normal/unset), the original children are returned as-is.
 */
/**
 * @param hostIsInline - true when the host element is inline. Block pseudo-elements
 *   are demoted to inline to avoid injecting block children into inline formatting context.
 */
export function injectPseudoElements(
  children: StyledNode[],
  parentStyle: ComputedStyle,
  target: SelectorTarget,
  rules: readonly CssRule[] | undefined,
  index: RuleIndex | undefined,
  ancestors: readonly SelectorTarget[],
  hostIsInline?: boolean,
): StyledNode[] {
  if (!rules || rules.length === 0) return children;

  let before = buildPseudoNode('before', target, parentStyle, rules, index, ancestors);
  let after = buildPseudoNode('after', target, parentStyle, rules, index, ancestors);

  if (!before && !after) return children;

  // Inline hosts cannot contain block children — demote to inline
  if (hostIsInline) {
    before = demoteToInline(before);
    after = demoteToInline(after);
  }

  const hasBlockPseudo =
    before?.style.display === DISPLAY_VALUES.Block || after?.style.display === DISPLAY_VALUES.Block;

  const result: StyledNode[] = [];
  if (before) result.push(before);
  // When a block pseudo-element is mixed with inline/text children, wrap the
  // inline runs in anonymous block boxes so the layout engine's hasBlockChildren
  // path doesn't silently drop them (CSS §9.2.1.1 anonymous block boxes).
  if (hasBlockPseudo && children.length > 0) {
    result.push(...wrapInlineRuns(children, parentStyle));
  } else {
    result.push(...children);
  }
  if (after) result.push(after);
  return result;
}

function demoteToInline(node: StyledNode | undefined): StyledNode | undefined {
  if (!node || node.style.display !== DISPLAY_VALUES.Block) return node;
  return { ...node, type: 'inline', style: { ...node.style, display: DISPLAY_VALUES.Inline } };
}

/**
 * Wrap consecutive inline/text children in anonymous block StyledNodes.
 * Existing block children pass through unchanged.
 */
function wrapInlineRuns(children: StyledNode[], parentStyle: ComputedStyle): StyledNode[] {
  const result: StyledNode[] = [];
  let inlineRun: StyledNode[] = [];

  const flushRun = (): void => {
    if (inlineRun.length === 0) return;
    result.push({ type: 'block', style: inheritableStyle(parentStyle), children: inlineRun });
    inlineRun = [];
  };

  for (const child of children) {
    const isBlock = child.type === 'block' && child.style.display !== DISPLAY_VALUES.InlineBlock;
    if (isBlock) {
      flushRun();
      result.push(child);
    } else {
      inlineRun.push(child);
    }
  }
  flushRun();
  return result;
}

interface MatchedPseudoRule {
  readonly rawDeclarations: string;
  readonly specificity: Specificity;
}

function buildPseudoNode(
  pseudo: 'before' | 'after',
  target: SelectorTarget,
  parentStyle: ComputedStyle,
  rules: readonly CssRule[],
  index: RuleIndex | undefined,
  ancestors: readonly SelectorTarget[],
): StyledNode | undefined {
  const candidates = index ? index.getCandidates(target.tag, target.className, target.id) : rules;

  const matches: MatchedPseudoRule[] = [];
  let contentText: string | null | undefined;
  let contentSpecificity: Specificity = [0, 0, 0];

  for (const rule of candidates) {
    if (extractPseudoElement(rule.selector) !== pseudo) continue;
    const base = stripPseudoElement(rule.selector);
    // Bare ::before / ::after (no element selector) acts as universal — matches any element
    if (base.length > 0 && !matchesSelector(target, base, ancestors)) continue;

    const spec = calculateSpecificity(rule.selector);
    matches.push({ rawDeclarations: rule.rawDeclarations, specificity: spec });

    const parsed = parseContentValue(rule.rawDeclarations);
    if (parsed !== undefined && compareSpecificity(spec, contentSpecificity) >= 0) {
      contentText = parsed;
      contentSpecificity = spec;
    }
  }

  // content: none/normal or not declared → no pseudo-element
  if (contentText === null || contentText === undefined) return undefined;
  if (matches.length === 0) return undefined;

  matches.sort((a, b) => compareSpecificity(a.specificity, b.specificity));
  const style = resolvePseudoStyle(matches, parentStyle);

  if (style.display === DISPLAY_VALUES.None) return undefined;

  const isBlock = style.display === DISPLAY_VALUES.Block;
  const nodeType = isBlock ? 'block' : 'inline';
  const textChild: StyledNode = { type: 'text', content: contentText, style, children: [] };
  return { type: nodeType, style, children: [textChild] };
}

function resolvePseudoStyle(
  matches: readonly MatchedPseudoRule[],
  parentStyle: ComputedStyle,
): ComputedStyle {
  // Pseudo-elements default to inline display (CSS spec), not block
  const base: ComputedStyle = { ...inheritableStyle(parentStyle), display: DISPLAY_VALUES.Inline };
  const parentFontSize = parentStyle.fontSize;

  // Two-pass em resolution (same as resolver.ts applyRules)
  let resolvedFontSize = base.fontSize;
  for (const m of matches) {
    const parsed = parseCssDeclarations(m.rawDeclarations, parentFontSize);
    if (parsed.fontSize !== undefined) resolvedFontSize = parsed.fontSize;
  }

  let style: ComputedStyle = { ...base, fontSize: resolvedFontSize };
  for (const m of matches) {
    const parsed = parseCssDeclarations(m.rawDeclarations, resolvedFontSize);
    style = { ...style, ...parsed, fontSize: resolvedFontSize };
  }
  return style;
}
