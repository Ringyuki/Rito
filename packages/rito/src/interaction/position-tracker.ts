/**
 * L1 PositionTracker — tracks reading position with serialize/restore.
 *
 * Consumers call update() on spread change. The tracker computes a
 * ReadingPosition and notifies listeners. Positions are JSON-serializable
 * for persistence by the consumer.
 */

import type { Page, Spread } from '../layout/core/types';
import type { ChapterRange } from '../runtime/types';
import { createReadingPosition, resolveReadingPosition, type ReadingPosition } from './position';

export interface PositionTracker {
  update(spreadIndex: number): void;
  getCurrent(): ReadingPosition | null;
  serialize(): string;
  restore(serialized: string): number | undefined;
  onPositionChange(cb: (position: ReadingPosition) => void): () => void;
}

export function createPositionTracker(
  spreads: readonly Spread[],
  pages: readonly Page[],
  chapterMap: ReadonlyMap<string, ChapterRange>,
): PositionTracker {
  let current: ReadingPosition | null = null;
  const listeners = new Set<(p: ReadingPosition) => void>();

  function notify(pos: ReadingPosition): void {
    for (const cb of listeners) cb(pos);
  }

  return {
    update(spreadIndex) {
      current = createReadingPosition(spreads, pages, chapterMap, spreadIndex);
      notify(current);
    },

    getCurrent: () => current,

    serialize() {
      return JSON.stringify(current);
    },

    restore(serialized) {
      try {
        const parsed = JSON.parse(serialized) as ReadingPosition;
        if (typeof parsed.spreadIndex !== 'number') return undefined;
        const idx = resolveReadingPosition(parsed, spreads);
        current = createReadingPosition(spreads, pages, chapterMap, idx);
        notify(current);
        return idx;
      } catch {
        return undefined;
      }
    },

    onPositionChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
