import { createRitoCoreWasmReaderRevisionSession } from './core-contracts';
import type { BrowserReaderWorkerClient } from './core-contracts';
import {
  recordBrowserReaderAcceptedRevision,
  scheduleBrowserReaderRevisionOwnerRetirement,
  type BrowserReaderRevisionSessionOwner,
  withReaderSessionDisposeTimeout,
} from './reader-session-host';
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
    await disposeController(state, owner);
    try {
      await disposeAndWaitBrowserReaderWorkerClient(owner.worker);
    } catch (error: unknown) {
      warnRevisionRetirement(state, 'revision session worker retirement failed', error);
    }
  });
}

async function disposeController(
  state: BrowserReaderState,
  owner: BrowserReaderRevisionSessionOwner,
): Promise<void> {
  try {
    await withReaderSessionDisposeTimeout(Promise.resolve().then(() => owner.controller.dispose()));
  } catch (error: unknown) {
    warnRevisionRetirement(state, 'revision session retirement failed', error);
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
