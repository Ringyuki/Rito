import {
  createCandidateState,
  fitnessClassForRatio,
  fitnessDistance,
  FITNESS_DEMERITS,
  type CandidateState,
} from './fitness';
import { resolveLineWidth } from './line-width';
import type { KPBreakpoint, KPItem, LineWidthSpec } from './types';
export { emergencyBreaks } from './emergency';
export type { LineWidthSpec } from './types';

const TOLERANCE = 10;
const FLAGGED_DEMERITS = 3000;
const INF_BADNESS = 10000;

interface CumulativeSums {
  readonly width: Float64Array;
  readonly stretch: Float64Array;
  readonly shrink: Float64Array;
}

export function solveKP(items: readonly KPItem[], lineWidth: LineWidthSpec): number[] | undefined {
  if (items.length === 0) return undefined;

  const sums = buildSums(items);
  const initial: KPBreakpoint = {
    position: -1,
    demerits: 0,
    ratio: 0,
    fitness: 'tight',
    line: 0,
    prev: undefined,
  };
  let active: KPBreakpoint[] = [initial];
  let best: KPBreakpoint | undefined;

  for (let index = 0; index < items.length; index++) {
    if (!items[index] || !isLegalBreak(items, index)) continue;

    const current = items[index];
    const forced = current?.type === 'penalty' && current.penalty === -Infinity;
    const finishing = forced && index === items.length - 1;
    const result = stepBreak(items, index, active, lineWidth, sums, forced, finishing);

    active = result.active;
    if (result.finished && (!best || result.finished.demerits < best.demerits)) {
      best = result.finished;
    }
    if (active.length === 0 && !best) return undefined;
  }

  if (!best) return undefined;

  const positions: number[] = [];
  let current: KPBreakpoint | undefined = best;
  while (current && current.position >= 0) {
    positions.push(current.position);
    current = current.prev;
  }
  positions.reverse();
  return positions;
}

function buildSums(items: readonly KPItem[]): CumulativeSums {
  const width = new Float64Array(items.length + 1);
  const stretch = new Float64Array(items.length + 1);
  const shrink = new Float64Array(items.length + 1);

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (!item) continue;
    width[index + 1] = (width[index] ?? 0) + (item.type === 'penalty' ? 0 : item.width);
    stretch[index + 1] = (stretch[index] ?? 0) + (item.type === 'glue' ? item.stretch : 0);
    shrink[index + 1] = (shrink[index] ?? 0) + (item.type === 'glue' ? item.shrink : 0);
  }

  return { width, stretch, shrink };
}

function stepBreak(
  items: readonly KPItem[],
  position: number,
  active: readonly KPBreakpoint[],
  lineWidth: LineWidthSpec,
  sums: CumulativeSums,
  forced: boolean,
  finishing: boolean,
): { active: KPBreakpoint[]; finished: KPBreakpoint | undefined } {
  const candidates = createCandidateState();
  const survivors: KPBreakpoint[] = [];
  let finished: KPBreakpoint | undefined;

  const recordFinished = (breakpoint: KPBreakpoint): void => {
    if (!finished || breakpoint.demerits < finished.demerits) finished = breakpoint;
  };

  for (const node of active) {
    const ratio = breakpointRatio(items, node, position, lineWidth, sums);
    if (ratio < -1) {
      if (forced)
        pushBreakpoint(node, position, ratio, items, finishing, candidates, recordFinished);
      continue;
    }
    if (ratio > TOLERANCE) {
      if (forced) {
        pushBreakpoint(node, position, ratio, items, finishing, candidates, recordFinished);
      } else {
        survivors.push(node);
      }
      continue;
    }

    const breakpoint = makeBreakpoint(node, position, ratio, items);
    if (finishing) {
      recordFinished(breakpoint);
    } else if (forced) {
      candidates.add(breakpoint);
    } else {
      candidates.add(breakpoint);
      survivors.push(node);
    }
  }

  return { active: [...survivors, ...candidates.values()], finished };
}

function breakpointRatio(
  items: readonly KPItem[],
  node: KPBreakpoint,
  position: number,
  lineWidth: LineWidthSpec,
  sums: CumulativeSums,
): number {
  return adjustmentRatio(
    items,
    node.position,
    position,
    resolveLineWidth(lineWidth, node.line),
    sums,
  );
}

function pushBreakpoint(
  node: KPBreakpoint,
  position: number,
  ratio: number,
  items: readonly KPItem[],
  finishing: boolean,
  candidates: CandidateState,
  recordFinished: (breakpoint: KPBreakpoint) => void,
): void {
  const breakpoint = makeBreakpoint(node, position, ratio, items);
  if (finishing) {
    recordFinished(breakpoint);
  } else {
    candidates.add(breakpoint);
  }
}

function makeBreakpoint(
  node: KPBreakpoint,
  position: number,
  ratio: number,
  items: readonly KPItem[],
): KPBreakpoint {
  const item = items[position];
  const badness = ratio < -1 ? INF_BADNESS : Math.min(100 * Math.abs(ratio) ** 3, INF_BADNESS);
  const penalty = item?.type === 'penalty' ? item.penalty : 0;
  let demerits = !isFinite(penalty)
    ? (1 + badness) ** 2
    : penalty >= 0
      ? (1 + badness + penalty) ** 2
      : (1 + badness) ** 2 - penalty ** 2;

  if (item?.type === 'penalty' && item.flagged) {
    const previousItem = node.position >= 0 ? items[node.position] : undefined;
    if (previousItem?.type === 'penalty' && previousItem.flagged) {
      demerits += FLAGGED_DEMERITS;
    }
  }

  const fitness = fitnessClassForRatio(ratio);
  if (node.position >= 0 && fitnessDistance(node.fitness, fitness) > 1) {
    demerits += FITNESS_DEMERITS;
  }

  return {
    position,
    demerits: demerits + node.demerits,
    ratio,
    fitness,
    line: node.line + 1,
    prev: node,
  };
}

function isLegalBreak(items: readonly KPItem[], index: number): boolean {
  const item = items[index];
  if (!item) return false;
  if (item.type === 'penalty') return item.penalty < Infinity;
  if (item.type === 'glue') return index > 0 && items[index - 1]?.type === 'box';
  return false;
}

function adjustmentRatio(
  items: readonly KPItem[],
  startPos: number,
  endPos: number,
  lineWidth: number,
  sums: CumulativeSums,
): number {
  const dims = getLineDimensions(items, startPos, endPos, sums);
  const endItem = items[endPos];
  const penaltyWidth = endItem?.type === 'penalty' ? endItem.width : 0;
  const adjustment = lineWidth - (dims.width + penaltyWidth);

  if (adjustment > 0) return dims.stretch > 0 ? adjustment / dims.stretch : INF_BADNESS;
  if (adjustment < 0) return dims.shrink > 0 ? adjustment / dims.shrink : -INF_BADNESS;
  return 0;
}

function getLineDimensions(
  items: readonly KPItem[],
  startPos: number,
  endPos: number,
  sums: CumulativeSums,
): { width: number; stretch: number; shrink: number } {
  const from = startPos + 1;
  let width = (sums.width[endPos] ?? 0) - (sums.width[from] ?? 0);
  let stretch = (sums.stretch[endPos] ?? 0) - (sums.stretch[from] ?? 0);
  let shrink = (sums.shrink[endPos] ?? 0) - (sums.shrink[from] ?? 0);

  for (let index = from; index < endPos; index++) {
    const item = items[index];
    if (!item || item.type === 'box') break;
    if (item.type === 'glue') {
      width -= item.width;
      stretch -= item.stretch;
      shrink -= item.shrink;
    }
  }

  return { width, stretch, shrink };
}
