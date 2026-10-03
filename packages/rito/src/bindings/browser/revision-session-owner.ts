import { createRitoCoreWasmReaderRevisionSession } from './core-contracts';
import type { BrowserReaderWorkerClient } from './core-contracts';
import {
  browserReaderSessionHostsClosed,
  recordBrowserReaderAcceptedRevision,
  scheduleBrowserReaderRevisionOwnerRetirement,
  type BrowserReaderRevisionSessionOwner,
  withReaderSessionDisposeTimeout,
} from './reader-session-host';
import { syncUnavailableFontFaces } from './font-availability';
import { catchUpBrowserReaderHostFontChanges } from './host-font-faces';
import { disposeAndWaitBrowserReaderWorkerClient } from './reader/worker-client';
import { resumeBrowserReaderSuspendedFrameMisses } from './suspended-frame-misses';
import type { BrowserReaderState } from './reader/types';

const candidateGenerations = new WeakMap<BrowserReaderState, number>();

export function createBrowserReaderRevisionSessionOwner(
  worker: BrowserReaderWorkerClient,
): BrowserReaderRevisionSessionOwner {
  const holder: { owner?: BrowserReaderRevisionSessionOwner } = {};
  const controller = createRitoCoreWasmReaderRevisionSession(worker, {
    onAcceptedRevision({ revision }) {
      if (!holder.owner) {
        throw new Error('Revision session accepted a revision before owner creation');
      }
      recordBrowserReaderAcceptedRevision(holder.owner, revision);
    },
  });
  const owner = {
    controller,
    worker,
    acceptedRevision: undefined,
    gateGeneration: 0,
    readsSuspended: false,
  };
  holder.owner = owner;
  return owner;
}

export async function installBrowserReaderRevisionCandidate(
  state: BrowserReaderState,
  owner: BrowserReaderRevisionSessionOwner,
): Promise<number> {
  const current = state.revisionSessions.current;
  if (current && current !== owner && current.worker.sessionId === owner.worker.sessionId) {
    await disposeController(state, owner);
    throw new Error('Revision session candidate must use an independent worker session');
  }
  const previous = state.revisionSessions.candidate;
  if (previous && previous !== owner && previous.worker.sessionId === owner.worker.sessionId) {
    await disposeController(state, owner);
    throw new Error('Revision session candidates must use independent worker sessions');
  }
  const generation = nextCandidateGeneration(state);
  state.revisionSessions.candidate = owner;
  if (previous && previous !== owner) await retireBrowserReaderRevisionOwner(state, previous);
  return generation;
}

export function ownsBrowserReaderRevisionCandidate(
  state: BrowserReaderState,
  owner: BrowserReaderRevisionSessionOwner,
  generation: number,
): boolean {
  return (
    !state.disposed &&
    ownsBrowserReaderCandidateGeneration(state, generation) &&
    state.revisionSessions.candidate === owner
  );
}

export function ownsBrowserReaderCandidateGeneration(
  state: BrowserReaderState,
  generation: number,
): boolean {
  return candidateGenerations.get(state) === generation;
}

export function watchBrowserReaderRevisionCandidateAbort(
  state: BrowserReaderState,
  owner: BrowserReaderRevisionSessionOwner,
  generation: number,
  signal: AbortSignal | undefined,
): () => void {
  if (!signal) return () => undefined;
  const abort = (): void => {
    if (!ownsBrowserReaderRevisionCandidate(state, owner, generation)) return;
    state.revisionSessions.candidate = undefined;
    void retireBrowserReaderRevisionOwner(state, owner);
  };
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  return () => {
    signal.removeEventListener('abort', abort);
  };
}

export async function abandonBrowserReaderRevisionCandidate(
  state: BrowserReaderState,
  owner: BrowserReaderRevisionSessionOwner,
): Promise<void> {
  if (state.revisionSessions.candidate === owner) state.revisionSessions.candidate = undefined;
  await retireBrowserReaderRevisionOwner(state, owner);
}

export async function retireBrowserReaderRevisionOwner(
  state: BrowserReaderState,
  owner: BrowserReaderRevisionSessionOwner,
): Promise<void> {
  // A suspension is released by whichever operation took it, but a retired
  // session runs no such operation. Clear it here so a reader that waits on
  // this owner's exact reads never waits on a session that no longer exists.
  if (owner.readsSuspended) {
    owner.readsSuspended = false;
    resumeBrowserReaderSuspendedFrameMisses(state, owner);
  }
  await scheduleBrowserReaderRevisionOwnerRetirement(state, owner, async () => {
    const released = await disposeController(state, owner);
    // Releasing the revision leaves the session with the publication and
    // fonts open; a healthy one is kept for the next layout.
    if (released && owner.terminalError === undefined) {
      await parkBrowserReaderStandbyWorker(state, owner.worker);
      return;
    }
    try {
      await disposeAndWaitBrowserReaderWorkerClient(owner.worker);
    } catch (error: unknown) {
      warnRevisionRetirement(state, 'revision session worker retirement failed', error);
    }
  });
}

/** Releases the owner's revision; false when that failed. */
async function disposeController(
  state: BrowserReaderState,
  owner: BrowserReaderRevisionSessionOwner,
): Promise<boolean> {
  try {
    await withReaderSessionDisposeTimeout(Promise.resolve().then(() => owner.controller.dispose()));
    return true;
  } catch (error: unknown) {
    warnRevisionRetirement(state, 'revision session retirement failed', error);
    return false;
  }
}

function warnRevisionRetirement(state: BrowserReaderState, message: string, reason: unknown): void {
  try {
    state.logger.warn(message, reason);
  } catch {
    // Logging must not interrupt controller or worker retirement.
  }
}

function nextCandidateGeneration(state: BrowserReaderState): number {
  const generation = (candidateGenerations.get(state) ?? 0) + 1;
  candidateGenerations.set(state, generation);
  return generation;
}

/**
 * The session kept for the next layout, brought up to date — the faces a
 * reader added or removed and the browser rejected since it last laid out,
 * the current render ratio — or undefined when there is none. The caller
 * owns it from here.
 */
export async function takeBrowserReaderStandbyWorker(
  state: BrowserReaderState,
): Promise<BrowserReaderWorkerClient | undefined> {
  const worker = state.revisionSessions.standby;
  if (!worker) return undefined;
  state.revisionSessions.standby = undefined;
  try {
    await worker.setRenderRatio(state.dpr);
    await catchUpBrowserReaderHostFontChanges(worker, state.pinnedFonts.changes);
    await syncUnavailableFontFaces(worker);
    return worker;
  } catch (error: unknown) {
    state.logger.warn('reader standby session could not be brought up to date', error);
    await disposeStandbyQuietly(state, worker);
    return undefined;
  }
}

/**
 * Keeps a session that holds no revision for the next layout. One is kept:
 * a newer one replaces it, and a reader being disposed keeps none.
 */
export async function parkBrowserReaderStandbyWorker(
  state: BrowserReaderState,
  worker: BrowserReaderWorkerClient,
): Promise<void> {
  if (browserReaderSessionHostsClosed(state)) {
    await disposeStandbyQuietly(state, worker);
    return;
  }
  const previous = state.revisionSessions.standby;
  state.revisionSessions.standby = worker;
  if (previous && previous !== worker) await disposeStandbyQuietly(state, previous);
}

async function disposeStandbyQuietly(
  state: BrowserReaderState,
  worker: BrowserReaderWorkerClient,
): Promise<void> {
  try {
    await disposeAndWaitBrowserReaderWorkerClient(worker);
  } catch (error: unknown) {
    state.logger.warn('reader standby session dispose failed', error);
  }
}
