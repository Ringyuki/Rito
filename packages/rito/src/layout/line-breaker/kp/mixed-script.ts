import { splitLineBreakSegments, splitTextUnits } from '../break-classifier';
import type { LineBreakOptions } from '../break-classifier';

export interface MixedTextPart {
  readonly text: string;
}

export function splitMixedTextParts(word: string, options?: LineBreakOptions): MixedTextPart[] {
  return splitLineBreakSegments(word, options).map((text) => ({ text }));
}

export function firstTextUnit(text: string): string {
  return splitTextUnits(text)[0] ?? '';
}

export function lastTextUnit(text: string): string {
  const units = splitTextUnits(text);
  return units[units.length - 1] ?? '';
}
