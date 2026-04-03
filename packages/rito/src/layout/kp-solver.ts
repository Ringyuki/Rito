/**
 * Knuth-Plass dynamic programming solver.
 * Uses the active-node-list approach to find optimal line break positions.
 */

import type { KPBreakpoint, KPItem } from './kp-types';

/** Lines with adjustment ratio above this are infeasible. */
const TOLERANCE = 10;
const FLAGGED_DEMERITS = 3000;
const INF_BADNESS = 10000;

interface CumulativeSums {
  readonly width: Float64Array;
  readonly stretch: Float64Array;
  readonly shrink: Float64Array;
}

function buildSums(items: readonly KPItem[]): CumulativeSums {
  const width = new Float64Array(items.length + 1);
  const stretch = new Float64Array(items.length + 1);
  const shrink = new Float64Array(items.length + 1);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    width[i + 1] = (width[i] ?? 0) + (item.type === 'penalty' ? 0 : item.width);
    stretch[i + 1] = (stretch[i] ?? 0) + (item.type === 'glue' ? item.stretch : 0);
    shrink[i + 1] = (shrink[i] ?? 0) + (item.type === 'glue' ? item.shrink : 0);
  }
  return { width, stretch, shrink };
}

/**
 * Solve for optimal breakpoints given KP items and a target line width.
 * Returns break positions or undefined if no feasible solution exists.
 */
export function solveKP(items: readonly KPItem[], lineWidth: number): number[] | undefined {
  if (items.length === 0) return undefined;
  const sums = buildSums(items);
  const initial: KPBreakpoint = { position: -1, demerits: 0, ratio: 0, line: 0, prev: undefined };
  let active: KPBreakpoint[] = [initial];
  let best: KPBreakpoint | undefined;

  for (let i = 0; i < items.length; i++) {
    if (!items[i] || !isLegalBreak(items, i)) continue;
    const cur = items[i];
    const forced = cur?.type === 'penalty' && cur.penalty === -Infinity;
    const finishing = forced && i === items.length - 1;
    const r = stepBreak(items, i, active, lineWidth, sums, forced, finishing);
    active = r.active;
    if (r.finished && (!best || r.finished.demerits < best.demerits)) best = r.finished;
    if (active.length === 0 && !best) return undefined;
  }
  if (!best) return undefined;
  const pos: number[] = [];
  let cur: KPBreakpoint | undefined = best;
  while (cur && cur.position >= 0) {
    pos.push(cur.position);
    cur = cur.prev;
  }
  pos.reverse();
  return pos;
}

function stepBreak(
  items: readonly KPItem[],
  i: number,
  active: readonly KPBreakpoint[],
  lineWidth: number,
  sums: CumulativeSums,
  forced: boolean,
  finishing: boolean,
): { active: KPBreakpoint[]; finished: KPBreakpoint | undefined } {
  const cands: KPBreakpoint[] = [];
  const surv: KPBreakpoint[] = [];
  let fin: KPBreakpoint | undefined;
  const rec = (bp: KPBreakpoint): void => {
    if (!fin || bp.demerits < fin.demerits) fin = bp;
  };

  for (const node of active) {
    const ratio = adjRatio(items, node.position, i, lineWidth, sums);
    if (ratio < -1) {
      if (forced) {
        const bp = mkBreak(node, i, ratio, items);
        if (finishing) rec(bp);
        else cands.push(bp);
      }
      continue;
    }
    if (ratio > TOLERANCE) {
      if (forced) {
        const bp = mkBreak(node, i, ratio, items);
        if (finishing) rec(bp);
        else cands.push(bp);
      } else surv.push(node);
      continue;
    }
    const bp = mkBreak(node, i, ratio, items);
    if (finishing) rec(bp);
    else if (forced) cands.push(bp);
    else {
      cands.push(bp);
      surv.push(node);
    }
  }
  return { active: [...surv, ...cands], finished: fin };
}

function mkBreak(
  node: KPBreakpoint,
  position: number,
  ratio: number,
  items: readonly KPItem[],
): KPBreakpoint {
  const item = items[position];
  const badness = ratio < -1 ? INF_BADNESS : Math.min(100 * Math.abs(ratio) ** 3, INF_BADNESS);
  const pen = item?.type === 'penalty' ? item.penalty : 0;
  let dem = !isFinite(pen)
    ? (1 + badness) ** 2
    : pen >= 0
      ? (1 + badness + pen) ** 2
      : (1 + badness) ** 2 - pen ** 2;
  if (item?.type === 'penalty' && item.flagged) {
    const prev = node.position >= 0 ? items[node.position] : undefined;
    if (prev?.type === 'penalty' && prev.flagged) dem += FLAGGED_DEMERITS;
  }
  return { position, demerits: dem + node.demerits, ratio, line: node.line + 1, prev: node };
}

/** Emergency greedy fallback when the DP solver fails. */
export function emergencyBreaks(items: readonly KPItem[], lineWidth: number): number[] {
  const pos: number[] = [];
  let w = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    if (item.type === 'penalty' && item.penalty === -Infinity) {
      pos.push(i);
      w = 0;
      continue;
    }
    if (item.type === 'box') {
      w = emBox(items, pos, i, item.width, w, lineWidth);
    } else if (item.type === 'glue') {
      w += item.width;
    }
  }
  return pos;
}

function emBox(
  items: readonly KPItem[],
  pos: number[],
  i: number,
  bw: number,
  cw: number,
  lw: number,
): number {
  if (cw + bw <= lw || cw === 0) return cw + bw;
  const start = pos.length > 0 ? (pos[pos.length - 1] ?? 0) + 1 : 0;
  let bp = -1;
  for (let j = i - 1; j >= start; j--) {
    const p = items[j];
    if (p?.type === 'glue' || (p?.type === 'penalty' && isFinite(p.penalty))) {
      bp = j;
      break;
    }
  }
  if (bp >= 0) {
    pos.push(bp);
    let nw = 0;
    for (let j = bp + 1; j <= i; j++) {
      const r = items[j];
      if (r && r.type !== 'penalty') nw += r.width;
    }
    return nw;
  }
  if (i > 0) {
    pos.push(i - 1);
    return bw;
  }
  return cw + bw;
}

function isLegalBreak(items: readonly KPItem[], i: number): boolean {
  const item = items[i];
  if (!item) return false;
  if (item.type === 'penalty') return item.penalty < Infinity;
  if (item.type === 'glue') return i > 0 && items[i - 1]?.type === 'box';
  return false;
}

function adjRatio(
  items: readonly KPItem[],
  startPos: number,
  endPos: number,
  lineWidth: number,
  sums: CumulativeSums,
): number {
  const d = lineDims(items, startPos, endPos, sums);
  const endItem = items[endPos];
  const penW = endItem?.type === 'penalty' ? endItem.width : 0;
  const adj = lineWidth - (d.nw + penW);
  if (adj > 0) return d.st > 0 ? adj / d.st : INF_BADNESS;
  if (adj < 0) return d.sh > 0 ? adj / d.sh : -INF_BADNESS;
  return 0;
}

function lineDims(
  items: readonly KPItem[],
  startPos: number,
  endPos: number,
  sums: CumulativeSums,
): { nw: number; st: number; sh: number } {
  const from = startPos + 1;
  let nw = (sums.width[endPos] ?? 0) - (sums.width[from] ?? 0);
  let st = (sums.stretch[endPos] ?? 0) - (sums.stretch[from] ?? 0);
  let sh = (sums.shrink[endPos] ?? 0) - (sums.shrink[from] ?? 0);
  for (let j = from; j < endPos; j++) {
    const it = items[j];
    if (!it || it.type === 'box') break;
    if (it.type === 'glue') {
      nw -= it.width;
      st -= it.stretch;
      sh -= it.shrink;
    }
  }
  return { nw, st, sh };
}
