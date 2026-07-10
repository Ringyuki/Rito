import type { LineWidthSpec } from './types';

export function resolveLineWidth(spec: LineWidthSpec, lineIndex: number): number {
  if (typeof spec === 'number') return spec;
  return lineIndex === 0 ? spec.firstLine : spec.subsequentLines;
}
