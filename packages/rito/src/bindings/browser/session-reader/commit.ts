import type { LayoutConfig } from '../../../reader';
import type { BrowserReaderArtifact } from '../reader-session';
import {
  prepareSessionReaderFrame,
  releaseSessionReaderFrame,
  warmSessionReaderNeighbours,
} from './frames';
import { createSessionReaderLayoutView, type SessionReaderRevisionLayout } from './layout-view';
import type { SessionReaderFrame, SessionReaderState } from './state';

/** The page table of the revision behind the artifact `artifactId`. */
export async function readSessionReaderLayout(
  state: SessionReaderState,
  artifactId: bigint,
): Promise<SessionReaderRevisionLayout> {
  const result = await state.session.navigation({ kind: 'layout', artifactId });
  if (result.kind !== 'layout') throw new Error('Reader session answered a layout query wrongly');
  return result.layout;
}

/**
 * Prepares `artifact` for a commit: its paint resources and, read meanwhile,
 * its revision's page table. With both in hand before the session is asked
 * to show the artifact, nothing can fail between the session showing it and
 * the reader showing it. A failure gives the artifact back.
 */
export async function prepareSessionReaderCandidate(
  state: SessionReaderState,
  artifact: BrowserReaderArtifact,
): Promise<{ frame: SessionReaderFrame; layout: SessionReaderRevisionLayout }> {
  const [prepared, table] = await Promise.allSettled([
    prepareSessionReaderFrame(state, artifact, false),
    readSessionReaderLayout(state, artifact.artifactId),
  ]);
  // Preparing released the artifact when it failed.
  if (prepared.status === 'rejected') throw prepared.reason;
  if (table.status === 'rejected') {
    await releaseSessionReaderFrame(state, prepared.value);
    throw table.reason;
  }
  return { frame: prepared.value, layout: table.value };
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
  state.log.note('commit', {
    scope,
    pages: state.view.pageCount,
    spreads: state.view.spreads.length,
    spread: frame.spreadIndex,
    generation: state.layoutGeneration,
  });
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
