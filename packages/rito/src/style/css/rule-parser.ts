import type { CssRule, FontFaceRule } from '../core/types';
import { parseCssDeclarations } from './property-parser';

/**
 * Parse a CSS stylesheet string into an array of CssRule objects.
 * Handles comments, @-rules (skipped except @font-face), and grouped selectors.
 */
export function parseCssRules(css: string, baseFontSize: number): readonly CssRule[] {
  const cleaned = stripComments(css);
  const blocks = extractRuleBlocks(cleaned);
  const rules: CssRule[] = [];

  for (const block of blocks) {
    const declarations = parseCssDeclarations(block.body, baseFontSize);
    // Keep pseudo-element rules even if only `content` is declared
    // (content is not in PROPERTY_HANDLERS, so declarations may be empty)
    const hasPseudoElement = /::?(?:before|after)\b/i.test(block.selector);
    if (Object.keys(declarations).length === 0 && !hasPseudoElement) continue;

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

/**
 * Parse @font-face rules from a CSS stylesheet string.
 */
export function parseFontFaceRules(css: string): readonly FontFaceRule[] {
  const cleaned = stripComments(css);
  const rules: FontFaceRule[] = [];
  let i = 0;

  while (i < cleaned.length) {
    // Skip whitespace
    while (i < cleaned.length && /\s/.test(cleaned[i] ?? '')) i++;
    if (i >= cleaned.length) break;

    if (cleaned[i] === '@') {
      const keyword = cleaned.slice(i, i + 11).toLowerCase();
      if (keyword.startsWith('@font-face')) {
        const braceStart = cleaned.indexOf('{', i);
        if (braceStart === -1) break;
        const braceEnd = findClosingBrace(cleaned, braceStart);
        if (braceEnd === -1) break;
        const body = cleaned.slice(braceStart + 1, braceEnd).trim();
        const rule = parseFontFaceBody(body);
        if (rule) rules.push(rule);
        i = braceEnd + 1;
        continue;
      }
      i = skipAtRule(cleaned, i);
      continue;
    }
    // Skip non-@-rule content
    const braceStart = cleaned.indexOf('{', i);
    if (braceStart === -1) break;
    const braceEnd = findClosingBrace(cleaned, braceStart);
    if (braceEnd === -1) break;
    i = braceEnd + 1;
  }

  return rules;
}

function parseFontFaceBody(body: string): FontFaceRule | undefined {
  let family: string | undefined;
  let src: string | undefined;
  let weight: string | undefined;
  let style: string | undefined;

  for (const decl of body.split(';')) {
    const colonIdx = decl.indexOf(':');
    if (colonIdx === -1) continue;
    const prop = decl.slice(0, colonIdx).trim().toLowerCase();
    const val = decl.slice(colonIdx + 1).trim();

    if (prop === 'font-family') {
      family = val.replace(/^["']|["']$/g, '');
    } else if (prop === 'src') {
      const urlMatch = val.match(/url\(\s*["']?([^"')]+)["']?\s*\)/);
      if (urlMatch?.[1]) src = urlMatch[1];
    } else if (prop === 'font-weight') {
      weight = val;
    } else if (prop === 'font-style') {
      style = val;
    }
  }

  if (!family || !src) return undefined;

  const result: { family: string; src: string; weight?: string; style?: string } = { family, src };
  if (weight) result.weight = weight;
  if (style) result.style = style;
  return result;
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
    if (css[i] === '@') {
      i = skipAtRule(css, i);
      continue;
    }

    const braceStart = css.indexOf('{', i);
    if (braceStart === -1) break;

    const selector = css.slice(i, braceStart).trim();
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

  if (semiPos !== -1 && (bracePos === -1 || semiPos < bracePos)) {
    return semiPos + 1;
  }

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
