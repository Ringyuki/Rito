import type { MutableStylePatch } from '../../core/style-patch';
import type { ComputedStyle } from '../../core/types';
import { parseLength } from '../parse-utils';

type NumericStyleKey = {
  [K in keyof ComputedStyle]: ComputedStyle[K] extends number | undefined ? K : never;
}[keyof ComputedStyle];

type MarginKey = 'marginLeft' | 'marginRight';
type MarginAutoFlag = 'marginLeftAuto' | 'marginRightAuto';

const AUTO_MARGIN_FLAGS: Readonly<Record<MarginKey, MarginAutoFlag>> = {
  marginLeft: 'marginLeftAuto',
  marginRight: 'marginRightAuto',
};

function setNumericValue(result: MutableStylePatch, key: NumericStyleKey, value: number): void {
  Object.assign(result, { [key]: value });
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
