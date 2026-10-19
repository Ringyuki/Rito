import type { LayoutConfig } from '../../../reader';
import {
  readSessionReaderLayout,
  releaseSessionReaderFrame,
  type SessionReaderLayoutCandidate,
} from './artifacts';
import { warmSessionReaderNeighbours } from './frames';
import { sessionReaderLaidOutGeometry } from './layout-options';
import { createSessionReaderLayoutView } from './layout-view';
import { sessionReaderClosed, type SessionReaderState } from './state';

/**
 * Makes a candidate the session already shows the committed layout: the
 * host is told which spread it now shows, and the spreads of the layout it
 * replaces are given back before the operation that commits it ends. A
 * revision laid out for one chapter commits with chapter scope; the whole
 * book, whose artifacts carry book page numbers, with book scope.
 *
 * `turned` is how many spreads the host has turned past the page the
 * candidate replaces, for a candidate that renumbers the same pages (the
 * book over its chapter): the host stays on the spread it turned to.
 */
export async function commitSessionReaderLayout(
  state: SessionReaderState,
  { frame, layout }: SessionReaderLayoutCandidate,
  config: LayoutConfig,
  turned = 0,
): Promise<void> {
  const replaced = [...state.frames.values()].filter((held) => held !== frame);
  const scope = frame.artifact.bookPageIndex === undefined ? 'chapter' : 'book';
  state.layoutGeneration += 1;
  state.frames = new Map([[frame.spreadIndex, frame]]);
  state.pendingFrames.clear();
  state.view = createSessionReaderLayoutView(layout, scope, state.publication);
  state.visible = frame;
  const last = state.view.spreads.length - 1;
  state.activeSpreadIndex = Math.min(Math.max(frame.spreadIndex + turned, 0), last);
  state.config = config;
  state.geometry = sessionReaderLaidOutGeometry(config, frame.artifact);
  state.dpr = frame.prepared.ratio;
  state.bookIdleSteps = 0;
  state.bookStalled = false;
  state.log.note('commit', {
    scope,
    pages: state.view.pageCount,
    spreads: state.view.spreads.length,
    spread: state.activeSpreadIndex,
    generation: state.layoutGeneration,
  });
  try {
    for (const listener of state.layoutCommittedListeners) listener(state.activeSpreadIndex);
    if (scope === 'book') {
      for (const resume of [...state.bookWaiters]) resume();
      state.bookWaiters.clear();
    }
    warmSessionReaderNeighbours(state);
  } finally {
    await Promise.all(replaced.map((held) => releaseSessionReaderFrame(state, held)));
  }
}

/**
 * Reads the whole page table of the committed layout when its commit read
 * only the pages laid out for the spread shown (a window was being
 * resized), and tells the host the layout's table changed: the same
 * spreads, and the rest of them.
 */
export async function completeSessionReaderLayout(state: SessionReaderState): Promise<void> {
  if (state.view.complete) return;
  const generation = state.layoutGeneration;
  const layout = await readSessionReaderLayout(state, state.visible.artifact.artifactId);
  if (sessionReaderClosed(state) || generation !== state.layoutGeneration) return;
  state.view = createSessionReaderLayoutView(layout, state.view.scope, state.publication);
  state.log.note('commit', {
    scope: state.view.scope,
    pages: state.view.pageCount,
    complete: true,
  });
  for (const listener of state.layoutCommittedListeners) listener(state.activeSpreadIndex);
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
