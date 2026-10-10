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

/** The engine paginates the whole book in one step whatever the budget says. */
const BOOK_QUANTUM = 512;

/** A layout ready to commit: the page it shows, prepared, and its revision's page table. */
export interface SessionReaderLayoutCandidate {
  readonly frame: SessionReaderFrame;
  readonly layout: SessionReaderRevisionLayout;
}

/** The page table of the revision behind the artifact `artifactId`. */
export async function readSessionReaderLayout(
  state: SessionReaderState,
  artifactId: bigint,
): Promise<SessionReaderRevisionLayout> {
  const result = await state.session.navigation({ kind: 'layout', artifactId });
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
 * session show the result: request, prepare, adopt. Resolves undefined,
 * with the result given back, when `overtaken` says a newer request stands.
 */
export async function requestSessionReaderLayout(
  state: SessionReaderState,
  config: LayoutConfig,
  overtaken: () => boolean,
): Promise<SessionReaderLayoutCandidate | undefined> {
  const visible = state.visible.artifact;
  const artifact = await state.session.requestArtifact({
    layout: sessionReaderSessionLayout(config, state.dpr),
    locator: visible.locator,
    textProfile: visible.textProfile,
  });
  const candidate = await prepareCandidate(state, artifact);
  if (overtaken()) {
    await releaseSessionReaderFrame(state, candidate.frame);
    return undefined;
  }
  await adopt(state, candidate.frame, () =>
    state.session.adoptForegroundCandidate(visible.artifactId, artifact.artifactId),
  );
  return candidate;
}

/**
 * Takes one step of the whole-book layout behind the page shown. A step
 * that brings the page under its book-wide number has the session show it
 * and resolves with it; `more` says the book is not laid out yet, `moved`
 * that the reader left the page meanwhile (`stillShown` said so, and the
 * page was given back), `complete` that there is nothing left to bring.
 */
export async function advanceSessionReaderBook(
  state: SessionReaderState,
  stillShown: () => boolean,
): Promise<SessionReaderLayoutCandidate | 'more' | 'moved' | 'complete'> {
  const visible = state.visible.artifact;
  const advance = await state.session.advanceBackgroundOnce(visible.artifactId, BOOK_QUANTUM);
  if (advance.artifact === undefined) return advance.state === 'complete' ? 'complete' : 'more';
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
): Promise<SessionReaderLayoutCandidate> {
  const [prepared, table] = await Promise.allSettled([
    prepareFrame(state, artifact, false),
    readSessionReaderLayout(state, artifact.artifactId),
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
