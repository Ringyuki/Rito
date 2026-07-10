import type { BoxShadow, TextShadow } from '../../core/types';
import { parseLength } from '../parse-utils';
import type { PropertyHandler, PropertyHandlers } from './types';

/**
 * Parse a box-shadow or text-shadow CSS value.
 * Supports multiple shadows (comma-separated), inset keyword, and standard length/color tokens.
 */

const handleBoxShadow: PropertyHandler = (result, value, emBase, rootFontSize): void => {
  if (value === 'none') {
    result.boxShadow = [];
    return;
  }
  const shadows = splitShadows(value)
    .map((s) => parseBoxShadow(s, emBase, rootFontSize))
    .filter((s): s is BoxShadow => s !== undefined);
  if (shadows.length > 0) result.boxShadow = shadows;
};

const handleTextShadow: PropertyHandler = (result, value, emBase, rootFontSize): void => {
  if (value === 'none') {
    result.textShadow = [];
    return;
  }
  const shadows = splitShadows(value)
    .map((s) => parseTextShadow(s, emBase, rootFontSize))
    .filter((s): s is TextShadow => s !== undefined);
  if (shadows.length > 0) result.textShadow = shadows;
};

export const SHADOW_PROPERTY_HANDLERS: PropertyHandlers = {
  'box-shadow': handleBoxShadow,
  'text-shadow': handleTextShadow,
};

// ---------------------------------------------------------------------------

/** Split comma-separated shadow values, respecting parentheses in rgb()/rgba(). */
function splitShadows(value: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      result.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  result.push(value.slice(start).trim());
  return result.filter((s) => s.length > 0);
}

function parseBoxShadow(raw: string, emBase: number, rootFontSize: number): BoxShadow | undefined {
  const inset = raw.includes('inset');
  const cleaned = raw.replace(/\binset\b/g, '').trim();
  const { lengths, color } = extractLengthsAndColor(cleaned, emBase, rootFontSize);
  if (lengths.length < 2) return undefined;
  return {
    offsetX: lengths[0] ?? 0,
    offsetY: lengths[1] ?? 0,
    blur: lengths[2] ?? 0,
    spread: lengths[3] ?? 0,
    color: color ?? '#000000',
    inset,
  };
}

function parseTextShadow(
  raw: string,
  emBase: number,
  rootFontSize: number,
): TextShadow | undefined {
  const { lengths, color } = extractLengthsAndColor(raw, emBase, rootFontSize);
  if (lengths.length < 2) return undefined;
  return {
    offsetX: lengths[0] ?? 0,
    offsetY: lengths[1] ?? 0,
    blur: lengths[2] ?? 0,
    color: color ?? '#000000',
  };
}

/** Extract numeric lengths and the color token from a shadow value string. */
function extractLengthsAndColor(
  raw: string,
  emBase: number,
  rootFontSize: number,
): { lengths: number[]; color: string | undefined } {
  const lengths: number[] = [];
  let color: string | undefined;

  // Tokenize: split on whitespace but keep rgb()/rgba()/hsl() together
  const tokens = tokenize(raw);
  for (const token of tokens) {
    const len = parseLength(token, emBase, rootFontSize);
    if (len !== undefined) {
      lengths.push(len);
    } else {
      // Assume it's a color
      color = token;
    }
  }
  return { lengths, color };
}

/** Split on whitespace, keeping parenthesized groups together. */
function tokenize(value: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let start = 0;
  let inToken = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '(') {
      depth++;
      inToken = true;
    } else if (ch === ')') {
      depth--;
    } else if (ch === ' ' && depth === 0) {
      if (inToken) {
        tokens.push(value.slice(start, i));
        inToken = false;
      }
      start = i + 1;
      continue;
    }
    if (!inToken) {
      start = i;
      inToken = true;
    }
  }
  if (inToken) tokens.push(value.slice(start));
  return tokens;
}
