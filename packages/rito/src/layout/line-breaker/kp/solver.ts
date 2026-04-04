import type { KPBreakpoint, KPItem } from './types';

const TOLERANCE = 10;
const FLAGGED_DEMERITS = 3000;
const INF_BADNESS = 10000;

interface CumulativeSums {
  readonly width: Float64Array;
  readonly stretch: Float64Array;
  readonly shrink: Float64Array;
}

export function solveKP(items: readonly KPItem[], lineWidth: number): number[] | undefined {
  if (items.length === 0) return undefined;

  const sums = buildSums(items);
  const initial: KPBreakpoint = { position: -1, demerits: 0, ratio: 0, line: 0, prev: undefined };
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

export function emergencyBreaks(items: readonly KPItem[], lineWidth: number): number[] {
  const positions: number[] = [];
  let currentWidth = 0;

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (!item) continue;

    if (item.type === 'penalty' && item.penalty === -Infinity) {
      positions.push(index);
      currentWidth = 0;
      continue;
    }

    if (item.type === 'box') {
      currentWidth = emergencyBox(items, positions, index, item.width, currentWidth, lineWidth);
    } else if (item.type === 'glue') {
      currentWidth += item.width;
    }
  }

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
  lineWidth: number,
  sums: CumulativeSums,
  forced: boolean,
  finishing: boolean,
): { active: KPBreakpoint[]; finished: KPBreakpoint | undefined } {
  const candidates: KPBreakpoint[] = [];
  const survivors: KPBreakpoint[] = [];
  let finished: KPBreakpoint | undefined;

  const recordFinished = (breakpoint: KPBreakpoint): void => {
    if (!finished || breakpoint.demerits < finished.demerits) finished = breakpoint;
  };

  for (const node of active) {
    const ratio = adjustmentRatio(items, node.position, position, lineWidth, sums);
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
      candidates.push(breakpoint);
    } else {
      candidates.push(breakpoint);
      survivors.push(node);
    }
  }

  return { active: [...survivors, ...candidates], finished };
}

function pushBreakpoint(
  node: KPBreakpoint,
  position: number,
  ratio: number,
  items: readonly KPItem[],
  finishing: boolean,
  candidates: KPBreakpoint[],
  recordFinished: (breakpoint: KPBreakpoint) => void,
): void {
  const breakpoint = makeBreakpoint(node, position, ratio, items);
  if (finishing) {
    recordFinished(breakpoint);
  } else {
    candidates.push(breakpoint);
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

  return {
    position,
    demerits: demerits + node.demerits,
    ratio,
    line: node.line + 1,
    prev: node,
  };
}

function emergencyBox(
  items: readonly KPItem[],
  positions: number[],
  index: number,
  boxWidth: number,
  currentWidth: number,
  lineWidth: number,
): number {
  if (currentWidth + boxWidth <= lineWidth || currentWidth === 0) {
    return currentWidth + boxWidth;
  }

  const start = positions.length > 0 ? (positions[positions.length - 1] ?? 0) + 1 : 0;
  let breakPos = -1;
  for (let cursor = index - 1; cursor >= start; cursor--) {
    const candidate = items[cursor];
    if (
      candidate?.type === 'glue' ||
      (candidate?.type === 'penalty' && isFinite(candidate.penalty))
    ) {
      breakPos = cursor;
      break;
    }
  }

  if (breakPos >= 0) {
    positions.push(breakPos);
    let nextWidth = 0;
    for (let cursor = breakPos + 1; cursor <= index; cursor++) {
      const item = items[cursor];
      if (item && item.type !== 'penalty') nextWidth += item.width;
    }
    return nextWidth;
  }

  if (index > 0) {
    positions.push(index - 1);
    return boxWidth;
  }

  return currentWidth + boxWidth;
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
