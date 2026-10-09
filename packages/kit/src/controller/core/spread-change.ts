import type { Reader } from '@ritojs/core';
import type { TypedEmitter } from '../../utils/event-emitter';
import type { ReaderControllerEvents } from '../types';

type Emitter = TypedEmitter<ReaderControllerEvents>;

const published = new WeakMap<Emitter, number>();

/**
 * The only publisher of the `spreadChange` event. Each call site keeps
 * its own timing and reentrancy checks (listeners may navigate
 * synchronously), but the lookup-then-publish shape lives here so no
 * writer can drift into publishing an index without its spread.
 *
 * While the reader's layout covers only the chapter being read, spread
 * indexes count from that chapter and mean nothing to a host: the event is
 * held back, and the commit of the whole book publishes where the reader is.
 *
 * Returns whether the event was published (false when the spread is not
 * yet part of the publication, or its index is not a book-wide one).
 */
export function publishSpreadChange(
  emitter: Emitter,
  reader: Reader,
  spreadIndex: number,
): boolean {
  if (showsChapterAlone(reader)) return false;
  const spread = reader.spreads[spreadIndex];
  if (!spread) return false;
  published.set(emitter, spreadIndex);
  emitter.emit('spreadChange', { spreadIndex, spread });
  return true;
}

/** The spread hosts were last told of; undefined before the first `spreadChange`. */
export function publishedSpread(emitter: Emitter): number | undefined {
  return published.get(emitter);
}

/** Whether the reader's committed layout is one chapter, numbered from its own first page. */
export function showsChapterAlone(reader: Reader): boolean {
  return reader.layoutScope === 'chapter';
}
