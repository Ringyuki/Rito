import type { LayoutConfig } from '../../../reader';
import { RitoReaderError, type BrowserReaderArtifact } from '../reader-session';
import { sessionReaderSessionLayout } from './layout-options';
import type { SessionReaderRevisionLayout } from './layout-view';
import {
  notifySessionReaderSpreadInvalidated,
  sessionReaderClosed,
  type SessionReaderFrame,
  type SessionReaderState,
} from './state';

// Everything the reader does that creates, adopts, commits or releases one
// of its session's artifacts. No other module calls those session methods,
// and each function here runs inside one operation of the reader's queue.
// A reader never holds an artifact it is not showing, about to show or
// giving back: whatever is not adopted or installed is released before the
// function returns or throws.

/**
 * The most pages a step of the whole-book layout lays out, the engine's
 * `READER_FRAME_QUANTUM_PAGES`: a step is what stands between two paints.
 */
export const BOOK_QUANTUM = 4;

/** A layout ready to commit: the page it shows, prepared, and its revision's page table. */
export interface SessionReaderLayoutCandidate {
  readonly frame: SessionReaderFrame;
  readonly layout: SessionReaderRevisionLayout;
}

/**
 * The page table of the revision behind the artifact `artifactId`: all of
 * it, or with `whole` false the pages laid out so far.
 */
export async function readSessionReaderLayout(
  state: SessionReaderState,
  artifactId: bigint,
  whole = true,
): Promise<SessionReaderRevisionLayout> {
  const result = await state.session.navigation({ kind: 'layout', artifactId, whole });
  if (result.kind !== 'layout') throw new Error('Reader session answered a layout query wrongly');
  return result.layout;
}

/** The artifact the session opened with, prepared and shown. */
export async function adoptSessionReaderFirstFrame(
  state: SessionReaderState,
): Promise<SessionReaderFrame> {
  const frame = await prepareFrame(state, state.session.initialArtifact, false);
  await state.session.adoptForegroundCandidate(undefined, frame.artifact.artifactId);
  return frame;
}

/**
 * Lays the chapter out again under `config` at the page shown and has the
 * session show the result: request, prepare, adopt.
 */
export async function requestSessionReaderLayout(
  state: SessionReaderState,
  config: LayoutConfig,
): Promise<SessionReaderLayoutCandidate> {
  const visible = state.visible.artifact;
  const artifact = await state.session.requestArtifact({
    layout: sessionReaderSessionLayout(config, state.dpr),
    locator: visible.locator,
    textProfile: visible.textProfile,
  });
  // While the host holds the book (a window being resized), only the pages
  // laid out so far are read: the rest would be laid out for every size.
  const candidate = await prepareCandidate(state, artifact, state.bookHolds === 0);
  await adopt(state, candidate.frame, () =>
    state.session.adoptForegroundCandidate(visible.artifactId, artifact.artifactId),
  );
  return candidate;
}

/**
 * Takes one step of the whole-book layout behind the page shown. A step
 * that brings the page under its book-wide number has the session show it
 * and resolves with it; `laying-out` says the step laid more of the book
 * out, `more` that it brought nothing yet, `moved` that the reader left
 * the page meanwhile (`stillShown` said so, and the page was given back),
 * `complete` that there is nothing left to bring.
 */
export async function advanceSessionReaderBook(
  state: SessionReaderState,
  stillShown: () => boolean,
): Promise<SessionReaderLayoutCandidate | 'laying-out' | 'more' | 'moved' | 'complete'> {
  const visible = state.visible.artifact;
  const advance = await state.session.advanceBackgroundOnce(visible.artifactId, BOOK_QUANTUM);
  if (advance.artifact === undefined) {
    if (advance.state === 'complete') return 'complete';
    return advance.state === 'started' || advance.state === 'advanced' ? 'laying-out' : 'more';
  }
  const candidate = await prepareCandidate(state, advance.artifact);
  if (!stillShown()) {
    await releaseSessionReaderFrame(state, candidate.frame);
    return 'moved';
  }
  const { artifactId } = candidate.frame.artifact;
  await adopt(state, candidate.frame, () =>
    state.session.adoptBackgroundCandidate(visible.artifactId, artifactId),
  );
  return candidate;
}

/** One spread of the committed layout, prepared; the session can be asked to show it. */
export async function peekSessionReaderFrame(
  state: SessionReaderState,
  spreadIndex: number,
): Promise<SessionReaderFrame> {
  const artifact = await state.session.peekSpread(state.visible.artifact.artifactId, spreadIndex);
  return prepareFrame(state, artifact, true);
}

/** Has the session show a spread it published for that, in place of the one it shows. */
export async function commitSessionReaderFrame(
  state: SessionReaderState,
  frame: SessionReaderFrame,
): Promise<void> {
  await state.session.commitPeekedArtifact(
    state.visible.artifact.artifactId,
    frame.artifact.artifactId,
  );
  frame.committable = false;
  state.visible = frame;
}

export async function releaseSessionReaderFrame(
  state: SessionReaderState,
  frame: SessionReaderFrame,
): Promise<void> {
  frame.stopWatchingImages();
  try {
    frame.prepared.dispose();
  } catch (error) {
    state.logger.warn('reader spread resources did not release cleanly', error);
  }
  await releaseArtifact(state, frame.artifact);
}

/**
 * Prepares `artifact` to become the committed layout: its paint resources
 * and, read meanwhile, its revision's page table. With both in hand before
 * the session is asked to show the artifact, nothing can fail between the
 * session showing it and the reader showing it.
 */
async function prepareCandidate(
  state: SessionReaderState,
  artifact: BrowserReaderArtifact,
  whole = true,
): Promise<SessionReaderLayoutCandidate> {
  const [prepared, table] = await Promise.allSettled([
    prepareFrame(state, artifact, false),
    readSessionReaderLayout(state, artifact.artifactId, whole),
  ]);
  // Preparing gave the artifact back when it failed.
  if (prepared.status === 'rejected') throw prepared.reason;
  if (table.status === 'rejected') {
    await releaseSessionReaderFrame(state, prepared.value);
    throw table.reason;
  }
  return { frame: prepared.value, layout: table.value };
}

/** Prepares an artifact's paint resources; one that cannot be prepared is given back. */
async function prepareFrame(
  state: SessionReaderState,
  artifact: BrowserReaderArtifact,
  committable: boolean,
): Promise<SessionReaderFrame> {
  let frame: SessionReaderFrame;
  try {
    const prepared = await state.presenter.prepare(artifact);
    const spreadIndex = artifact.localSpreadIndex;
    const stopWatchingImages = prepared.onImagesChanged(() => {
      notifySessionReaderSpreadInvalidated(state, spreadIndex);
    });
    frame = { spreadIndex, artifact, prepared, committable, stopWatchingImages };
  } catch (error) {
    await releaseArtifact(state, artifact);
    throw error;
  }
  if (sessionReaderClosed(state)) {
    // The reader closed while the spread was prepared: nothing will paint it.
    await releaseSessionReaderFrame(state, frame);
    throw new RitoReaderError('session-disposed', 'Reader closed while a spread was prepared');
  }
  return frame;
}

/** Asks the session to show a prepared candidate; one it refuses is given back. */
async function adopt(
  state: SessionReaderState,
  frame: SessionReaderFrame,
  ask: () => Promise<unknown>,
): Promise<void> {
  try {
    await ask();
  } catch (error) {
    await releaseSessionReaderFrame(state, frame);
    throw error;
  }
}

async function releaseArtifact(
  state: SessionReaderState,
  artifact: BrowserReaderArtifact,
): Promise<void> {
  if (state.disposed) return;
  try {
    await state.session.release(artifact.artifactId);
  } catch (error) {
    if (!sessionReaderClosed(state)) state.logger.warn('reader artifact release failed', error);
  }
}
