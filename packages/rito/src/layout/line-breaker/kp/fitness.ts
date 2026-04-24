import type { KPBreakpoint, KPFitnessClass } from './types';

export const FITNESS_DEMERITS = 100;

export interface CandidateState {
  readonly add: (breakpoint: KPBreakpoint) => void;
  readonly values: () => KPBreakpoint[];
}

export function createCandidateState(): CandidateState {
  const best = new Map<KPFitnessClass, KPBreakpoint>();
  return {
    add: (breakpoint) => {
      const current = best.get(breakpoint.fitness);
      if (!current || breakpoint.demerits < current.demerits) {
        best.set(breakpoint.fitness, breakpoint);
      }
    },
    values: () => Array.from(best.values()),
  };
}

export function fitnessClassForRatio(ratio: number): KPFitnessClass {
  if (ratio < -0.5) return 'very-tight';
  if (ratio <= 0.5) return 'tight';
  if (ratio <= 1) return 'loose';
  return 'very-loose';
}

export function fitnessDistance(left: KPFitnessClass, right: KPFitnessClass): number {
  return Math.abs(fitnessRank(left) - fitnessRank(right));
}

function fitnessRank(fitness: KPFitnessClass): number {
  switch (fitness) {
    case 'very-tight':
      return 0;
    case 'tight':
      return 1;
    case 'loose':
      return 2;
    case 'very-loose':
      return 3;
  }
}
