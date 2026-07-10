import type { HitEntry } from './types';

interface IndexedEntry {
  readonly entry: HitEntry;
  readonly sourceIndex: number;
}

export interface HitIndex {
  readonly byTop: readonly IndexedEntry[];
  readonly maxHeight: number;
}

export function createHitIndex(entries: readonly HitEntry[]): HitIndex {
  const byTop = entries
    .map((entry, sourceIndex) => ({ entry, sourceIndex }))
    .sort((a, b) => a.entry.bounds.y - b.entry.bounds.y || a.sourceIndex - b.sourceIndex);
  return {
    byTop,
    maxHeight: entries.reduce((max, entry) => Math.max(max, entry.bounds.height), 0),
  };
}

export function candidatesAtY(index: HitIndex, y: number): readonly HitEntry[] {
  const limit = upperBoundByTop(index.byTop, y);
  const minTop = y - index.maxHeight;
  const candidates: IndexedEntry[] = [];
  for (let position = limit - 1; position >= 0; position--) {
    const indexed = index.byTop[position];
    if (!indexed) continue;
    if (indexed.entry.bounds.y < minTop) break;
    if (y <= indexed.entry.bounds.y + indexed.entry.bounds.height) candidates.push(indexed);
  }
  candidates.sort((a, b) => a.sourceIndex - b.sourceIndex);
  return candidates.map(({ entry }) => entry);
}

function upperBoundByTop(entries: readonly IndexedEntry[], y: number): number {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const top = entries[middle]?.entry.bounds.y ?? Infinity;
    if (top <= y) low = middle + 1;
    else high = middle;
  }
  return low;
}
