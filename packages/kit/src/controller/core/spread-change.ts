import type { Reader } from '@ritojs/core';
import type { TypedEmitter } from '../../utils/event-emitter';
import type { ReaderControllerEvents } from '../types';

/**
 * The only publisher of the `spreadChange` event. Each call site keeps
 * its own timing and reentrancy checks (listeners may navigate
 * synchronously), but the lookup-then-publish shape lives here so no
 * writer can drift into publishing an index without its spread.
 *
 * Returns whether the event was published (false when the spread is not
 * yet part of the publication).
 */
export function publishSpreadChange(
  emitter: TypedEmitter<ReaderControllerEvents>,
  reader: Reader,
  spreadIndex: number,
): boolean {
  const spread = reader.spreads[spreadIndex];
  if (!spread) return false;
  emitter.emit('spreadChange', { spreadIndex, spread });
  return true;
}
