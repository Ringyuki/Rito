import type { LayoutConfig } from '../../../reader';
import { releaseSessionReaderFrame, warmSessionReaderNeighbours } from './frames';
import { createSessionReaderLayoutView, type SessionReaderRevisionLayout } from './layout-view';
import type { SessionReaderFrame, SessionReaderState } from './state';

/** The page table of the revision behind `frame`. */
export async function readSessionReaderLayout(
  state: SessionReaderState,
  frame: SessionReaderFrame,
): Promise<SessionReaderRevisionLayout> {
  const result = await state.session.navigation({
    kind: 'layout',
    artifactId: frame.artifact.artifactId,
  });
  if (result.kind !== 'layout') throw new Error('Reader session answered a layout query wrongly');
  return result.layout;
}

/**
 * Makes `frame` and its revision's page table the committed layout: the
 * spreads of the layout it replaces are given back, and the host is told
 * which spread it now shows. A revision laid out for one chapter commits
 * with chapter scope; the whole book, whose artifacts carry book page
 * numbers, with book scope.
 */
export function commitSessionReaderLayout(
  state: SessionReaderState,
  frame: SessionReaderFrame,
  layout: SessionReaderRevisionLayout,
  config: LayoutConfig,
): void {
  const replaced = [...state.frames.values()].filter((held) => held !== frame);
  const scope = frame.artifact.bookPageIndex === undefined ? 'chapter' : 'book';
  state.layoutGeneration += 1;
  state.frames = new Map([[frame.spreadIndex, frame]]);
  state.pendingFrames.clear();
  state.view = createSessionReaderLayoutView(layout, scope, state.publication);
  state.visible = frame;
  state.activeSpreadIndex = frame.spreadIndex;
  state.config = config;
  for (const held of replaced) void releaseSessionReaderFrame(state, held);
  for (const listener of state.layoutCommittedListeners) listener(frame.spreadIndex);
  if (scope === 'book') {
    for (const resume of [...state.bookWaiters]) resume();
    state.bookWaiters.clear();
  }
  warmSessionReaderNeighbours(state);
}

/** Resolves once the committed layout covers the whole book, or the reader closes. */
export function waitForSessionReaderBook(
  state: SessionReaderState,
  signal?: AbortSignal,
): Promise<void> {
  if (state.disposed || state.view.scope === 'book' || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const resume = (): void => {
      state.bookWaiters.delete(resume);
      signal?.removeEventListener('abort', resume);
      resolve();
    };
    state.bookWaiters.add(resume);
    signal?.addEventListener('abort', resume, { once: true });
  });
}
