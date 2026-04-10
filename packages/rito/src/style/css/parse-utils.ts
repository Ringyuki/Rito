import { evaluateCalc } from './calc';
import type { MutableStylePatch } from '../core/style-patch';

export { evaluateCalc } from './calc';

import { isPercentage } from './property-handlers/helpers';

const DEFAULT_ROOT_FONT_SIZE = 16;
type BoxSideKey =
  | 'marginTop'
  | 'marginRight'
  | 'marginBottom'
  | 'marginLeft'
  | 'paddingTop'
  | 'paddingRight'
  | 'paddingBottom'
  | 'paddingLeft';

type PctSideKey =
  | 'marginTopPct'
  | 'marginRightPct'
  | 'marginBottomPct'
  | 'marginLeftPct'
  | 'paddingTopPct'
  | 'paddingRightPct'
  | 'paddingBottomPct'
  | 'paddingLeftPct';

const BOX_TO_PCT: Readonly<Record<BoxSideKey, PctSideKey>> = {
  marginTop: 'marginTopPct',
  marginRight: 'marginRightPct',
  marginBottom: 'marginBottomPct',
  marginLeft: 'marginLeftPct',
  paddingTop: 'paddingTopPct',
  paddingRight: 'paddingRightPct',
  paddingBottom: 'paddingBottomPct',
  paddingLeft: 'paddingLeftPct',
};

/** Try to store a percentage value. Returns true if the value was a percentage. */
function tryAssignPct(result: MutableStylePatch, key: BoxSideKey, raw: string): boolean {
  if (!isPercentage(raw)) return false;
  const pct = parseFloat(raw.trim());
  if (!isNaN(pct)) result[BOX_TO_PCT[key]] = pct;
  return true;
}
type MarginSideKey = 'marginTop' | 'marginRight' | 'marginBottom' | 'marginLeft';

/** Parse a box-model length, rejecting % (needs containing-block resolution). */
function parseBoxLength(
  value: string,
  parentFontSize: number,
  rootFontSize: number = DEFAULT_ROOT_FONT_SIZE,
  viewport?: Viewport,
): number | undefined {
  const trimmed = value.trim();
  // Bare non-zero percentage
  if (trimmed.endsWith('%') && !trimmed.includes('calc') && parseFloat(trimmed) !== 0) {
    return undefined;
  }
  // calc() containing % — also unresolvable
  if (trimmed.includes('calc') && trimmed.includes('%')) return undefined;
  return parseLength(value, parentFontSize, rootFontSize, viewport);
}

/** Viewport dimensions for resolving vh/vw units. */
export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** Parse a CSS length value (px, pt, em, rem, %, vh, vw) to a number in px. */
export function parseLength(
  value: string,
  parentFontSize: number,
  rootFontSize: number = DEFAULT_ROOT_FONT_SIZE,
  viewport?: Viewport,
): number | undefined {
  const trimmed = value.trim().toLowerCase();

  // Handle calc() expressions
  if (trimmed.startsWith('calc(')) {
    return evaluateCalc(trimmed, parentFontSize, rootFontSize);
  }

  if (trimmed.endsWith('px')) return parseFloat(trimmed);
  if (trimmed.endsWith('pt')) return parseFloat(trimmed) * (4 / 3);
  if (trimmed.endsWith('rem')) return parseFloat(trimmed) * rootFontSize;
  if (trimmed.endsWith('vh') && viewport) return (parseFloat(trimmed) / 100) * viewport.height;
  if (trimmed.endsWith('vw') && viewport) return (parseFloat(trimmed) / 100) * viewport.width;
  if (trimmed.endsWith('em')) return parseFloat(trimmed) * parentFontSize;
  if (trimmed.endsWith('%')) return (parseFloat(trimmed) / 100) * parentFontSize;
  const num = parseFloat(trimmed);
  if (!isNaN(num) && /^\d/.test(trimmed)) return num;
  return undefined;
}

/**
 * Apply a CSS box shorthand (margin or padding) to the result object.
 * Handles 1-4 value patterns: all / TB+LR / T+LR+B / T+R+B+L
 */
export function applyBoxShorthand(
  result: MutableStylePatch,
  value: string,
  parentFontSize: number,
  keys: readonly [BoxSideKey, BoxSideKey, BoxSideKey, BoxSideKey],
  rootFontSize: number = DEFAULT_ROOT_FONT_SIZE,
  viewport?: Viewport,
): void {
  const parts = splitBoxValues(value.trim());
  const mapping = resolveBoxMapping(parts);
  const [top, right, bottom, left] = keys;

  for (const [key, raw] of [
    [top, mapping.top],
    [right, mapping.right],
    [bottom, mapping.bottom],
    [left, mapping.left],
  ] as const) {
    if (raw === undefined) continue;
    if (tryAssignPct(result, key, raw)) continue;
    const parsed = parseBoxLength(raw, parentFontSize, rootFontSize, viewport);
    if (parsed !== undefined) result[key] = parsed;
  }
}

/**
 * Apply the margin shorthand, detecting 'auto' for left/right margins.
 * Falls through to parseLength for non-auto values.
 */
export function applyBoxShorthandWithAuto(
  result: MutableStylePatch,
  value: string,
  parentFontSize: number,
  keys: readonly [MarginSideKey, MarginSideKey, MarginSideKey, MarginSideKey],
  rootFontSize: number = DEFAULT_ROOT_FONT_SIZE,
  viewport?: Viewport,
): void {
  const parts = splitBoxValues(value.trim());
  const [topKey, rightKey, bottomKey, leftKey] = keys;
  const mapping = resolveBoxMapping(parts);

  for (const [key, raw] of [
    [topKey, mapping.top],
    [rightKey, mapping.right],
    [bottomKey, mapping.bottom],
    [leftKey, mapping.left],
  ] as const) {
    if (raw === undefined) continue;
    if (raw.toLowerCase() === 'auto') {
      if (key === rightKey) {
        result[key] = 0;
        result.marginRightAuto = true;
      } else if (key === leftKey) {
        result[key] = 0;
        result.marginLeftAuto = true;
      } else {
        result[key] = 0;
      }
    } else if (tryAssignPct(result, key, raw)) {
      // Percentage stored — clear auto flag if applicable
      if (key === rightKey) result.marginRightAuto = false;
      if (key === leftKey) result.marginLeftAuto = false;
    } else {
      const parsed = parseBoxLength(raw, parentFontSize, rootFontSize, viewport);
      if (parsed !== undefined) {
        result[key] = parsed;
        if (key === rightKey) result.marginRightAuto = false;
        if (key === leftKey) result.marginLeftAuto = false;
      }
    }
  }
}

/** Resolve CSS 1-4 value shorthand into top/right/bottom/left raw strings. */
function resolveBoxMapping(parts: string[]): {
  top?: string | undefined;
  right?: string | undefined;
  bottom?: string | undefined;
  left?: string | undefined;
} {
  if (parts.length === 1) {
    return { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] };
  }
  if (parts.length === 2) {
    return { top: parts[0], right: parts[1], bottom: parts[0], left: parts[1] };
  }
  if (parts.length === 3) {
    return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[1] };
  }
  if (parts.length >= 4) {
    return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] };
  }
  return {};
}

/**
 * Split a box shorthand value into parts, respecting calc() expressions.
 * Simple whitespace splitting breaks calc(100% - 2rem), so we track parens.
 */
function splitBoxValues(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;

  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;

    if ((ch === ' ' || ch === '\t') && depth === 0) {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}
