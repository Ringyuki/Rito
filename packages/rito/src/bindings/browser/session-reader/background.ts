import { advanceSessionReaderBook } from './artifacts';
import { commitSessionReaderLayout, completeSessionReaderLayout } from './commit';
import { warmSessionReaderNeighbours } from './frames';
import { runSessionReaderOperation, wakeSessionReaderQueue } from './queue';
import { sessionReaderClosed, type SessionReaderState } from './state';

/** Steps in a row that may bring no page for one layout before the book is reported stuck. */
const BOOK_IDLE_STEPS = 64;

/**
 * Takes one step of laying the whole book out behind the chapter the reader
 * shows, and commits the book over that chapter when it arrives: the same
 * page, now under its book-wide number. Resolves whether another step is
 * wanted.
 *
 * It is what the reader's queue does when nothing waits. The step that
 * paginates the book occupies the session for as long as that takes, so it
 * starts only once what the reader was asked for is done, no host holds it
 * back, and the spreads a turn would show are loaded; a turn made while it
 * runs is painted from those and followed by the session afterwards.
 */
export async function stepSessionReaderBook(state: SessionReaderState): Promise<boolean> {
  if (state.disposed || state.view.scope === 'book' || state.bookStalled) return false;
  // The host holds it back (the sizes of a window being resized keep
  // coming); releasing the last hold wakes the queue.
  if (state.bookHolds > 0) return false;
  const shown = state.visible.spreadIndex;
  // The session did not follow the host to its spread (that failed, and
  // was reported): the book would be brought for a page the reader left.
  if (state.activeSpreadIndex !== shown) return false;
  try {
    const step = await advanceSessionReaderBook(state, () => state.activeSpreadIndex === shown);
    // The reader turned meanwhile: the queue follows it, then asks again.
    if (step === 'moved') return true;
    if (step === 'more') {
      state.bookIdleSteps += 1;
      if (state.bookIdleSteps <= BOOK_IDLE_STEPS) return true;
    }
    if (typeof step === 'string')
      throw new Error(`The whole-book layout brought no page (${step})`);
    // A turn made while the session adopted the page is kept: the book
    // numbers the chapter's spreads in the same order.
    await commitSessionReaderLayout(state, step, state.config, state.activeSpreadIndex - shown);
  } catch (error) {
    if (!sessionReaderClosed(state)) state.logger.warn('reader whole-book layout failed', error);
    // Left for the next thing the reader is asked to do, which tries again.
    state.bookStalled = true;
  }
  return false;
}

/** A host's hold on the whole-book run; the run waits until every hold is released. */
export function holdSessionReaderBook(state: SessionReaderState): () => void {
  state.bookHolds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.bookHolds -= 1;
    if (state.bookHolds > 0 || state.disposed) return;
    // The sizes stopped: the page table a resize read only in part is read whole.
    if (!state.view.complete) {
      void runSessionReaderOperation(state, 'asked', () => completeSessionReaderLayout(state));
    }
    warmSessionReaderNeighbours(state);
    wakeSessionReaderQueue(state);
  };
}
