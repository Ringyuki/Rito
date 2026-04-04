import type { StyledSegment } from '../../text/styled-segment';

export interface KPBox {
  readonly type: 'box';
  readonly width: number;
  readonly text: string;
  readonly segment: StyledSegment;
}

export interface KPGlue {
  readonly type: 'glue';
  readonly width: number;
  readonly stretch: number;
  readonly shrink: number;
}

export interface KPPenalty {
  readonly type: 'penalty';
  readonly width: number;
  readonly penalty: number;
  readonly flagged: boolean;
}

export type KPItem = KPBox | KPGlue | KPPenalty;

export interface KPBreakpoint {
  readonly position: number;
  readonly demerits: number;
  readonly ratio: number;
  readonly line: number;
  readonly prev: KPBreakpoint | undefined;
}
