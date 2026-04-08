import type { MutableStylePatch } from '../../core/style-patch';
import type { ComputedStyle } from '../../core/types';
import { parseLength } from '../parse-utils';

/**
 * Reject bare percentage values. CSS percentages on box-model properties
 * (width, height, margin, padding) depend on the containing block, but
 * parseLength incorrectly resolves them as font-relative. Ignore until
 * containing-block resolution is modeled in layout.
 */
/** Reject values that depend on containing-block percentage resolution. */
export function isPercentage(value: string): boolean {
  const trimmed = value.trim();
  // Bare percentage (not 0%)
  if (trimmed.endsWith('%') && !trimmed.includes('calc') && parseFloat(trimmed) !== 0) return true;
  // calc() containing % — also unresolvable without containing block
  if (trimmed.includes('calc') && trimmed.includes('%')) return true;
  return false;
}

type NumericStyleKey = Exclude<
  {
    [K in keyof ComputedStyle]: K extends `${string}Pct`
      ? never
      : ComputedStyle[K] extends number | undefined
        ? K
        : never;
  }[keyof ComputedStyle],
  undefined
>;

type MarginKey = 'marginLeft' | 'marginRight';
type MarginAutoFlag = 'marginLeftAuto' | 'marginRightAuto';

const AUTO_MARGIN_FLAGS: Readonly<Record<MarginKey, MarginAutoFlag>> = {
  marginLeft: 'marginLeftAuto',
  marginRight: 'marginRightAuto',
};

function setNumericValue(result: MutableStylePatch, key: NumericStyleKey, value: number): void {
  (result as Record<string, unknown>)[key] = value;
}

export function assignLength(
  result: MutableStylePatch,
  key: NumericStyleKey,
  value: string,
  emBase: number,
  rootFontSize: number,
  predicate: (resolved: number) => boolean = () => true,
): void {
  const resolved = parseLength(value, emBase, rootFontSize);
  if (resolved !== undefined && predicate(resolved)) {
    setNumericValue(result, key, resolved);
  }
}

export function assignMarginLength(
  result: MutableStylePatch,
  key: MarginKey,
  value: string,
  emBase: number,
  rootFontSize: number,
): void {
  if (value.trim().toLowerCase() === 'auto') {
    setNumericValue(result, key, 0);
    result[AUTO_MARGIN_FLAGS[key]] = true;
    return;
  }

  const resolved = parseLength(value, emBase, rootFontSize);
  if (resolved !== undefined) {
    setNumericValue(result, key, resolved);
    result[AUTO_MARGIN_FLAGS[key]] = false;
  }
}
