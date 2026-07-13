import type {
  BrowserReaderBoundedSession,
  BrowserReaderWorkerClient,
  CoreRevisionHandle,
} from './core-contracts';
import type {
  BrowserReaderRevisionHandle,
  BrowserReaderState,
  BrowserReaderWorkerRevisionHandle,
} from './reader/types';

export interface BrowserReaderBoundedSessionOwner {
  readonly controller: BrowserReaderBoundedSession;
  readonly worker: BrowserReaderWorkerClient;
  acceptedRevision: BrowserReaderWorkerRevisionHandle | undefined;
  gateGeneration: number;
  readsSuspended: boolean;
  terminalError?: Error | undefined;
}

export interface BrowserReaderBoundedSessionSlots {
  current: BrowserReaderBoundedSessionOwner | undefined;
  candidate: BrowserReaderBoundedSessionOwner | undefined;
}

export interface BrowserReaderExactReadGate {
  readonly owner: BrowserReaderBoundedSessionOwner;
  readonly generation: number;
  readonly commitGeneration: number;
}

export function recordBrowserReaderAcceptedRevision(
  owner: BrowserReaderBoundedSessionOwner,
  revision: CoreRevisionHandle,
): void {
  owner.acceptedRevision = {
    workerSessionId: owner.worker.sessionId,
    revisionId: revision.revisionId,
    revisionVersion: revision.revisionVersion,
  };
}

export function suspendBrowserReaderExactReads(
  state: BrowserReaderState,
): BrowserReaderExactReadGate | undefined {
  const owner = state.boundedSessions.current;
  if (!owner) return undefined;
  owner.gateGeneration += 1;
  owner.readsSuspended = true;
  if (state.revisionHandle) {
    state.commitGeneration += 1;
    state.revisionHandle = undefined;
  }
  return {
    owner,
    generation: owner.gateGeneration,
    commitGeneration: state.commitGeneration,
  };
}

export function restoreBrowserReaderExactReads(
  state: BrowserReaderState,
  gate: BrowserReaderExactReadGate,
): boolean {
  const revision = state.revisionBundle.revision;
  const accepted = gate.owner.acceptedRevision;
  const snapshot = gate.owner.controller.currentSnapshot();
  if (
    state.disposed ||
    state.revisionHandle ||
    state.commitGeneration !== gate.commitGeneration ||
    state.boundedSessions.current !== gate.owner ||
    gate.owner.gateGeneration !== gate.generation ||
    gate.owner.terminalError ||
    gate.owner.worker !== state.worker ||
    !snapshot ||
    snapshot.revision.revisionId !== revision.revisionId ||
    snapshot.revision.revisionVersion !== revision.revisionVersion ||
    accepted?.workerSessionId !== state.worker.sessionId ||
    accepted.revisionId !== revision.revisionId ||
    accepted.revisionVersion !== revision.revisionVersion
  ) {
    return false;
  }
  state.commitGeneration += 1;
  state.revisionHandle = {
    ...accepted,
    commitGeneration: state.commitGeneration,
  };
  gate.owner.readsSuspended = false;
  return true;
}

export function resumeBrowserReaderExactReads(
  state: BrowserReaderState,
  gate: BrowserReaderExactReadGate,
): boolean {
  const revision = state.revisionHandle;
  if (
    state.disposed ||
    !revision ||
    state.boundedSessions.current !== gate.owner ||
    gate.owner.gateGeneration !== gate.generation ||
    gate.owner.worker !== state.worker ||
    !sameWorkerRevision(gate.owner.acceptedRevision, revision)
  ) {
    return false;
  }
  gate.owner.readsSuspended = false;
  return true;
}

export function boundedOwnerAllowsRead(
  owner: BrowserReaderBoundedSessionOwner | undefined,
  worker: BrowserReaderWorkerClient,
  handle: BrowserReaderRevisionHandle,
): boolean {
  return (
    owner === undefined ||
    (!owner.terminalError &&
      !owner.readsSuspended &&
      owner.worker === worker &&
      sameWorkerRevision(owner.acceptedRevision, handle))
  );
}

export function disposeBrowserReaderSessionHosts(state: BrowserReaderState): void {
  const slots = state.boundedSessions;
  const owners = [slots.current, slots.candidate].filter((owner) => owner !== undefined);
  slots.current = undefined;
  slots.candidate = undefined;
  const workers = new Set([
    state.worker,
    state.foregroundWorker,
    ...owners.map(({ worker }) => worker),
  ]);
  if (state.fullReflowWorker) workers.add(state.fullReflowWorker);
  const controllers = new Set(owners.map(({ controller }) => controller));
  if (controllers.size === 0) {
    disposeWorkers(state, workers);
    return;
  }
  state.disposeTask = Promise.allSettled([...controllers].map((controller) => controller.dispose()))
    .then((results) => {
      for (const result of results) {
        if (result.status === 'rejected')
          state.logger.warn('bounded reader dispose failed', result.reason);
      }
    })
    .finally(() => {
      disposeWorkers(state, workers);
    });
}

function disposeWorkers(
  state: BrowserReaderState,
  workers: ReadonlySet<BrowserReaderWorkerClient>,
): void {
  for (const worker of workers) {
    try {
      worker.dispose();
    } catch (error) {
      state.logger.warn('reader worker dispose failed', error);
    }
  }
}

function sameWorkerRevision(
  left: BrowserReaderWorkerRevisionHandle | undefined,
  right: BrowserReaderWorkerRevisionHandle,
): boolean {
  return (
    left !== undefined &&
    left.workerSessionId === right.workerSessionId &&
    left.revisionId === right.revisionId &&
    left.revisionVersion === right.revisionVersion
  );
}
