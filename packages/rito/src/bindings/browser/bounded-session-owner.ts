import { createRitoCoreWasmBoundedReaderSession } from './core-contracts';
import type { BrowserReaderWorkerClient } from './core-contracts';
import {
  recordBrowserReaderAcceptedRevision,
  scheduleBrowserReaderBoundedOwnerRetirement,
  type BrowserReaderBoundedSessionOwner,
  withReaderSessionDisposeTimeout,
} from './reader-session-host';
import { disposeAndWaitBrowserReaderWorkerClient } from './reader/worker-client';
import { resumeBrowserReaderSuspendedFrameMisses } from './suspended-frame-misses';
import type { BrowserReaderState } from './reader/types';
import {
  createBrowserReaderContinuationBatchRegistration,
  retireBrowserReaderContinuationBatchOwner,
} from './adaptive-continuation-batch';

const candidateGenerations = new WeakMap<BrowserReaderState, number>();

export function createBrowserReaderBoundedSessionOwner(
  worker: BrowserReaderWorkerClient,
): BrowserReaderBoundedSessionOwner {
  const holder: { owner?: BrowserReaderBoundedSessionOwner } = {};
  const continuationBatch = createBrowserReaderContinuationBatchRegistration();
  const controller = createRitoCoreWasmBoundedReaderSession(worker, {
    continuationBatchQuanta: continuationBatch.resolve,
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
  continuationBatch.attach(owner);
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
    void retireBrowserReaderBoundedOwner(state, owner);
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
  // A suspension is released by whichever operation took it, but a retired
  // session runs no such operation. Clear it here so a reader that waits on
  // this owner's exact reads never waits on a session that no longer exists.
  if (owner.readsSuspended) {
    owner.readsSuspended = false;
    resumeBrowserReaderSuspendedFrameMisses(state, owner);
  }
  retireBrowserReaderContinuationBatchOwner(owner);
  await scheduleBrowserReaderBoundedOwnerRetirement(state, owner, async () => {
    await disposeController(state, owner);
    try {
      await disposeAndWaitBrowserReaderWorkerClient(owner.worker);
    } catch (error: unknown) {
      warnBoundedRetirement(state, 'bounded reader worker retirement failed', error);
    }
  });
}

async function disposeController(
  state: BrowserReaderState,
  owner: BrowserReaderBoundedSessionOwner,
): Promise<void> {
  try {
    await withReaderSessionDisposeTimeout(Promise.resolve().then(() => owner.controller.dispose()));
  } catch (error: unknown) {
    warnBoundedRetirement(state, 'bounded reader session retirement failed', error);
  }
}

function warnBoundedRetirement(state: BrowserReaderState, message: string, reason: unknown): void {
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
