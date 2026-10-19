import type {
  ReaderExactSourceRangeRequest,
  ReaderTextRange,
  ReaderTextRangeResolution,
} from '@ritojs/core';
import type { Emitter, Internals } from './types';

/**
 * A selection shown when a layout was replaced: where it reads in the
 * source, and whether its start edge followed the pointer.
 */
export interface CarriedSelection {
  readonly request: ReaderExactSourceRangeRequest;
  readonly backward: boolean;
}

/** The selection shown, if any, as it can be found again in another layout. */
export function carrySelection(internals: Internals): CarriedSelection | null {
  const selection = internals.engines.selection;
  if (selection.getState() !== 'selected') return null;
  const locator = selection.getSourceLocator();
  if (!locator?.sourceRange) return null;
  return {
    request: { href: locator.href, sourceRange: locator.sourceRange },
    backward: selection.getFocusEdge() === 'start',
  };
}

/**
 * Shows a carried selection again in the layout just committed, as a
 * browser keeps a selection through a resize: its source range is
 * resolved in the new layout and shown when it lands on the spread on
 * screen, no later layout or turn replaced the one it was resolved in,
 * and the reader started no other selection meanwhile.
 */
export function restoreSelection(
  internals: Internals,
  emitter: Emitter,
  carried: CarriedSelection | null,
): void {
  const interactions = internals.reader.interactions;
  const textSelection = interactions?.textSelection;
  if (!carried || !interactions?.enabled || !textSelection?.resolveTextRangeFromSource) return;
  const generation = internals.coordState.contentInteractionGeneration;
  const spreadIndex = internals.currentSpread;
  const current = (): boolean =>
    generation === internals.coordState.contentInteractionGeneration &&
    spreadIndex === internals.currentSpread;
  const report = (error: unknown): void => {
    emitter.emit('error', {
      message: error instanceof Error ? error.message : String(error),
      source: 'selection-restore',
    });
  };
  let task: Promise<ReaderTextRangeResolution | undefined>;
  try {
    task = textSelection.resolveTextRangeFromSource({ ...carried.request });
  } catch (error: unknown) {
    report(error);
    return;
  }
  void task.then(
    (resolution) => {
      if (!current() || resolution?.status !== 'resolved') return;
      const pages = internals.reader.spreads[spreadIndex]?.pageIndexes ?? [];
      if (!resolution.range.rects.some((rect) => pages.includes(rect.pageIndex))) return;
      internals.engines.selection.restore(
        carried.backward ? reversed(resolution.range) : resolution.range,
      );
    },
    (error: unknown) => {
      if (current()) report(error);
    },
  );
}

function reversed(range: ReaderTextRange): ReaderTextRange {
  return { ...range, anchor: range.end, focus: range.start };
}
