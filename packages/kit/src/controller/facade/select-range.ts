import type { ReaderExactSourceRangeRequest, ReaderTextRangeResolution } from '@ritojs/core';
import type { Emitter, Internals, RangeSelectionSlice } from './types';

export function buildRangeSelection(internals: Internals, emitter: Emitter): RangeSelectionSlice {
  const owner = { serial: 0 };
  return {
    selectRange(range) {
      owner.serial += 1;
      return selectSourceRange(internals, emitter, range, owner);
    },
  };
}

/**
 * Selects a source range as a reader's drag would: it is resolved in the
 * layout shown and becomes the selection when it lands on the spread on
 * screen, unless a turn, a relayout, a later call or the reader's own
 * selecting came first.
 */
async function selectSourceRange(
  internals: Internals,
  emitter: Emitter,
  range: ReaderExactSourceRangeRequest,
  owner: { serial: number },
): Promise<boolean> {
  const textSelection = internals.reader.interactions?.textSelection;
  if (!internals.reader.interactions?.enabled || !textSelection?.resolveTextRangeFromSource) {
    return false;
  }
  const selection = internals.engines.selection;
  const serial = owner.serial;
  const generation = internals.coordState.contentInteractionGeneration;
  const spreadIndex = internals.currentSpread;
  const watched = { changed: false };
  const stopWatching = selection.onSelectionChange(() => {
    watched.changed = true;
  });
  let resolution: ReaderTextRangeResolution | undefined;
  try {
    resolution = await textSelection.resolveTextRangeFromSource(copyRequest(range));
  } catch (error: unknown) {
    reportSelectRangeError(emitter, error);
    return false;
  } finally {
    stopWatching();
  }
  const current =
    !watched.changed &&
    serial === owner.serial &&
    generation === internals.coordState.contentInteractionGeneration &&
    spreadIndex === internals.currentSpread &&
    internals.coordState.nativeInteractionsAlive;
  if (!current || resolution?.status !== 'resolved') return false;
  const pages = internals.reader.spreads[spreadIndex]?.pageIndexes ?? [];
  if (!resolution.range.rects.some((rect) => pages.includes(rect.pageIndex))) return false;
  if (selection.getState() === 'selecting') return false;
  if (selection.getState() === 'selected') selection.clear();
  selection.restore(resolution.range);
  return selection.getState() === 'selected';
}

function copyRequest(range: ReaderExactSourceRangeRequest): ReaderExactSourceRangeRequest {
  const { start, end } = range.sourceRange;
  return {
    href: range.href,
    sourceRange: {
      start: { nodePath: [...start.nodePath], textOffset: start.textOffset },
      end: { nodePath: [...end.nodePath], textOffset: end.textOffset },
    },
  };
}

function reportSelectRangeError(emitter: Emitter, error: unknown): void {
  try {
    emitter.emit('error', {
      message: error instanceof Error ? error.message : String(error),
      source: 'select-range',
    });
  } catch {
    // Consumer error listeners must not turn a failed read into a rejection.
  }
}
