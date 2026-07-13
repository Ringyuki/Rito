import { createRitoCoreWasmBoundedReaderSession } from './core-contracts';
import type { BrowserReaderWorkerClient } from './core-contracts';
import {
  recordBrowserReaderAcceptedRevision,
  type BrowserReaderBoundedSessionOwner,
} from './reader-session-host';
import type { BrowserReaderState } from './reader/types';

const candidateGenerations = new WeakMap<BrowserReaderState, number>();

export function createBrowserReaderBoundedSessionOwner(
  worker: BrowserReaderWorkerClient,
): BrowserReaderBoundedSessionOwner {
  const holder: { owner?: BrowserReaderBoundedSessionOwner } = {};
  const controller = createRitoCoreWasmBoundedReaderSession(worker, {
    onAcceptedRevision({ revision }) {
      if (!holder.owner) {
        throw new Error('Bounded reader accepted a revision before owner creation');
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

export async function installBrowserReaderBoundedCandidate(
  state: BrowserReaderState,
  owner: BrowserReaderBoundedSessionOwner,
): Promise<number> {
  const current = state.boundedSessions.current;
  if (current && current !== owner && current.worker.sessionId === owner.worker.sessionId) {
    await disposeController(state, owner);
    throw new Error('Bounded reader candidate must use an independent worker session');
  }
  const previous = state.boundedSessions.candidate;
  if (previous && previous !== owner && previous.worker.sessionId === owner.worker.sessionId) {
    await disposeController(state, owner);
    throw new Error('Bounded reader candidates must use independent worker sessions');
  }
  const generation = nextCandidateGeneration(state);
  state.boundedSessions.candidate = owner;
  if (previous && previous !== owner) await retireBrowserReaderBoundedOwner(state, previous);
  return generation;
}

export function ownsBrowserReaderBoundedCandidate(
  state: BrowserReaderState,
  owner: BrowserReaderBoundedSessionOwner,
  generation: number,
): boolean {
  return (
    !state.disposed &&
    ownsBrowserReaderCandidateGeneration(state, generation) &&
    state.boundedSessions.candidate === owner
  );
}

export function ownsBrowserReaderCandidateGeneration(
  state: BrowserReaderState,
  generation: number,
): boolean {
  return candidateGenerations.get(state) === generation;
}

export function watchBrowserReaderBoundedCandidateAbort(
  state: BrowserReaderState,
  owner: BrowserReaderBoundedSessionOwner,
  generation: number,
  signal: AbortSignal | undefined,
): () => void {
  if (!signal) return () => undefined;
  const abort = (): void => {
    if (!ownsBrowserReaderBoundedCandidate(state, owner, generation)) return;
    state.boundedSessions.candidate = undefined;
    void disposeController(state, owner);
  };
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  return () => {
    signal.removeEventListener('abort', abort);
  };
}

export async function abandonBrowserReaderBoundedCandidate(
  state: BrowserReaderState,
  owner: BrowserReaderBoundedSessionOwner,
): Promise<void> {
  if (state.boundedSessions.candidate === owner) state.boundedSessions.candidate = undefined;
  await retireBrowserReaderBoundedOwner(state, owner);
}

export async function retireBrowserReaderBoundedOwner(
  state: BrowserReaderState,
  owner: BrowserReaderBoundedSessionOwner,
): Promise<void> {
  await disposeController(state, owner);
  try {
    owner.worker.dispose();
  } catch (error) {
    state.logger.warn('bounded reader worker retirement failed', error);
  }
}

async function disposeController(
  state: BrowserReaderState,
  owner: BrowserReaderBoundedSessionOwner,
): Promise<void> {
  try {
    await owner.controller.dispose();
  } catch (error) {
    state.logger.warn('bounded reader session retirement failed', error);
  }
}

function nextCandidateGeneration(state: BrowserReaderState): number {
  const generation = (candidateGenerations.get(state) ?? 0) + 1;
  candidateGenerations.set(state, generation);
  return generation;
}
