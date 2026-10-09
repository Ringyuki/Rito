import { RitoReaderError } from '../reader-session';
import { commitSessionReaderLayout, readSessionReaderLayout } from './commit';
import { prepareSessionReaderFrame, releaseSessionReaderFrame } from './frames';
import { runSessionReaderForeground, type SessionReaderState } from './state';

/** The engine paginates the whole book in one step whatever the budget says. */
const BACKGROUND_QUANTUM = 512;
/** Rounds a run may take before it gives up: each is one engine step or one lost race. */
const BACKGROUND_ROUNDS = 64;
const RETRY_DELAY_MS = 16;

/**
 * Lays the whole book out behind the chapter the reader shows and commits
 * it over that chapter: the same page, now under its book-wide number.
 *
 * The step that paginates the book occupies the session, so it starts only
 * once the spreads a turn would show are loaded. A turn inside the chapter
 * while it runs is answered from them; the run then asks again for the
 * spread the reader moved to, which the finished book answers at once.
 */
export function startSessionReaderBackground(state: SessionReaderState): void {
  if (state.disposed || state.view.scope === 'book') return;
  state.backgroundToken += 1;
  const token = state.backgroundToken;
  // One run at a time: the run this one replaces ends at its next check.
  state.background = state.background
    .then(() => runBackground(state, token))
    .catch((error: unknown) => {
      if (!state.disposed) state.logger.warn('reader whole-book layout failed', error);
    });
}

async function runBackground(state: SessionReaderState, token: number): Promise<void> {
  const current = (): boolean => !state.disposed && token === state.backgroundToken;
  for (let round = 0; round < BACKGROUND_ROUNDS && current(); round += 1) {
    // Turns and spread loads queued so far go first.
    await state.foreground;
    await state.frameLoads;
    if (!current()) return;
    const visible = state.visible;
    let advance;
    try {
      advance = await state.session.advanceBackgroundOnce(
        visible.artifact.artifactId,
        BACKGROUND_QUANTUM,
      );
    } catch (error) {
      if (!isRetryable(error)) throw error;
      await new Promise((resume) => setTimeout(resume, RETRY_DELAY_MS));
      continue;
    }
    if (advance.artifact === undefined) {
      if (advance.state === 'complete') return;
      continue;
    }
    const frame = await prepareSessionReaderFrame(state, advance.artifact, false);
    if (!current()) {
      await releaseSessionReaderFrame(state, frame);
      return;
    }
    const outcome = { adopted: false };
    await runSessionReaderForeground(state, async () => {
      if (!current() || state.visible !== visible) return;
      const [, layout] = await Promise.all([
        state.session.adoptBackgroundCandidate(
          visible.artifact.artifactId,
          frame.artifact.artifactId,
        ),
        readSessionReaderLayout(state, frame),
      ]);
      outcome.adopted = true;
      commitSessionReaderLayout(state, frame, layout, state.config);
    });
    if (outcome.adopted) return;
    // The reader turned while the candidate was prepared: it is for a
    // spread no longer shown.
    await releaseSessionReaderFrame(state, frame);
  }
}

/** The session was busy or the reader moved: the next round asks again. */
function isRetryable(error: unknown): boolean {
  return (
    error instanceof RitoReaderError &&
    (error.code === 'stale-request' ||
      error.code === 'request-busy' ||
      error.code === 'artifact-capacity' ||
      error.code === 'request-capacity')
  );
}
