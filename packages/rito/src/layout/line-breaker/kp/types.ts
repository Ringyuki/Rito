import type { InlineAtomSegment, StyledSegment } from '../../text/styled-segment';

export interface KPBox {
  readonly type: 'box';
  readonly width: number;
  readonly text: string;
  readonly segment: StyledSegment;
  readonly atom?: InlineAtomSegment;
}

export interface KPGlue {
  readonly type: 'glue';
  readonly width: number;
  readonly stretch: number;
  readonly shrink: number;
  readonly text: string;
  /** Source segment consumed by this glue (ordinary collapsed spaces/newlines). */
  readonly segment?: StyledSegment;
  readonly sourceLength?: number;
}

export interface KPPenalty {
  readonly type: 'penalty';
  readonly width: number;
  readonly penalty: number;
  readonly flagged: boolean;
}

export type KPItem = KPBox | KPGlue | KPPenalty;
export type LineWidthSpec =
  | number
  | { readonly firstLine: number; readonly subsequentLines: number };
export type KPFitnessClass = 'very-tight' | 'tight' | 'loose' | 'very-loose';

export interface KPBreakpoint {
  readonly position: number;
  readonly demerits: number;
  readonly ratio: number;
  readonly fitness: KPFitnessClass;
  readonly line: number;
  readonly prev: KPBreakpoint | undefined;
}
