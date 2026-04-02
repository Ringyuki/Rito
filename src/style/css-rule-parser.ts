import type { CssRule } from './types';
import { parseCssDeclarations } from './css-property-parser';

/**
 * Parse a CSS stylesheet string into an array of CssRule objects.
 * Handles comments, @-rules (skipped), and grouped selectors.
 */
export function parseCssRules(css: string, baseFontSize: number): readonly CssRule[] {
  const cleaned = stripComments(css);
  const blocks = extractRuleBlocks(cleaned);
  const rules: CssRule[] = [];

  for (const block of blocks) {
    const declarations = parseCssDeclarations(block.body, baseFontSize);
    if (Object.keys(declarations).length === 0) continue;

    // Split grouped selectors: "h1, h2 { ... }" → two rules
    const selectors = block.selector
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const selector of selectors) {
      rules.push({ selector, declarations, rawDeclarations: block.body });
    }
  }

  return rules;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

interface RuleBlock {
  readonly selector: string;
  readonly body: string;
}

function extractRuleBlocks(css: string): RuleBlock[] {
  const blocks: RuleBlock[] = [];
  let i = 0;

  while (i < css.length) {
    // Skip @-rules
    if (css[i] === '@') {
      i = skipAtRule(css, i);
      continue;
    }

    // Find opening brace
    const braceStart = css.indexOf('{', i);
    if (braceStart === -1) break;

    const selector = css.slice(i, braceStart).trim();

    // Find matching closing brace
    const braceEnd = findClosingBrace(css, braceStart);
    if (braceEnd === -1) break;

    if (selector.length > 0) {
      const body = css.slice(braceStart + 1, braceEnd).trim();
      blocks.push({ selector, body });
    }

    i = braceEnd + 1;
  }

  return blocks;
}

function skipAtRule(css: string, start: number): number {
  const bracePos = css.indexOf('{', start);
  const semiPos = css.indexOf(';', start);

  // @charset, @import end with semicolon
  if (semiPos !== -1 && (bracePos === -1 || semiPos < bracePos)) {
    return semiPos + 1;
  }

  // @media, @supports etc. have a block — skip to matching brace
  if (bracePos !== -1) {
    const end = findClosingBrace(css, bracePos);
    return end === -1 ? css.length : end + 1;
  }

  return css.length;
}

function findClosingBrace(css: string, openPos: number): number {
  let depth = 1;
  for (let i = openPos + 1; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}') depth--;
    if (depth === 0) return i;
  }
  return -1;
}
