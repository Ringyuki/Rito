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
import { disposeAndWaitBrowserReaderWorkerClient } from './reader/worker-client';

const READER_SESSION_DISPOSE_TIMEOUT_MS = 1_000;
const boundedOwnerRetirements = new WeakMap<BrowserReaderBoundedSessionOwner, Promise<void>>();
const pendingBoundedOwnerRetirements = new WeakMap<BrowserReaderState, Set<Promise<void>>>();

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
  /** The published layout identity that may be restored after a no-op mutation failure. */
  readonly publicationGeneration: number | undefined;
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
  const publicationGeneration = state.revisionHandle?.publicationGeneration;
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
    publicationGeneration,
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
    gate.publicationGeneration === undefined ||
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
    publicationGeneration: gate.publicationGeneration,
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
  const workers = new Set([state.worker, ...owners.map(({ worker }) => worker)]);
  const controllers = new Set(owners.map(({ controller }) => controller));
  state.disposeTask = Promise.all([
    drainBrowserReaderControllers(state, controllers),
    drainBrowserReaderBoundedOwnerRetirements(state),
  ]).then(() => releaseBrowserReaderWorkers(state, workers));
}

export function scheduleBrowserReaderBoundedOwnerRetirement(
  state: BrowserReaderState,
  owner: BrowserReaderBoundedSessionOwner,
  retire: () => Promise<void>,
): Promise<void> {
  const existing = boundedOwnerRetirements.get(owner);
  if (existing) return existing;
  const task = Promise.resolve()
    .then(retire)
    .catch((error: unknown) => {
      warnReaderDisposal(state, 'bounded reader owner retirement failed', error);
    });
  boundedOwnerRetirements.set(owner, task);
  const pending = pendingBoundedOwnerRetirements.get(state) ?? new Set<Promise<void>>();
  pending.add(task);
  pendingBoundedOwnerRetirements.set(state, pending);
  void task.then(() => {
    pending.delete(task);
    if (pending.size === 0 && pendingBoundedOwnerRetirements.get(state) === pending) {
      pendingBoundedOwnerRetirements.delete(state);
    }
  });
  return task;
}

export function withReaderSessionDisposeTimeout(task: Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      reject(
        new Error(
          `bounded reader dispose timed out after ${String(READER_SESSION_DISPOSE_TIMEOUT_MS)}ms`,
        ),
      );
    }, READER_SESSION_DISPOSE_TIMEOUT_MS);
    void task.then(
      () => {
        globalThis.clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        globalThis.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function drainBrowserReaderControllers(
  state: BrowserReaderState,
  controllers: ReadonlySet<BrowserReaderBoundedSession>,
): Promise<void> {
  const results = await Promise.allSettled(
    [...controllers].map((controller) =>
      withReaderSessionDisposeTimeout(Promise.resolve().then(() => controller.dispose())),
    ),
  );
  for (const result of results) {
    if (result.status === 'rejected') {
      warnReaderDisposal(state, 'bounded reader dispose failed', result.reason);
    }
  }
}

async function drainBrowserReaderBoundedOwnerRetirements(state: BrowserReaderState): Promise<void> {
  const drained = new Set<Promise<void>>();
  for (
    let pending = unseenBoundedOwnerRetirements(state, drained);
    pending.length > 0;
    pending = unseenBoundedOwnerRetirements(state, drained)
  ) {
    for (const task of pending) drained.add(task);
    await Promise.allSettled(pending);
  }
}

function unseenBoundedOwnerRetirements(
  state: BrowserReaderState,
  drained: ReadonlySet<Promise<void>>,
): Promise<void>[] {
  const retirements = pendingBoundedOwnerRetirements.get(state);
  return [...(retirements ?? [])].filter((task) => !drained.has(task));
}

async function releaseBrowserReaderWorkers(
  state: BrowserReaderState,
  fallbackWorkers: ReadonlySet<BrowserReaderWorkerClient>,
): Promise<void> {
  const disposeFactory = state.workerFactory.dispose;
  if (disposeFactory) {
    try {
      await disposeFactory.call(state.workerFactory);
      return;
    } catch (error: unknown) {
      warnReaderDisposal(state, 'reader worker factory dispose failed', error);
    }
  }
  const results = await Promise.allSettled(
    [...fallbackWorkers].map((worker) => disposeAndWaitBrowserReaderWorkerClient(worker)),
  );
  for (const result of results) {
    if (result.status === 'rejected') {
      warnReaderDisposal(state, 'reader worker dispose failed', result.reason);
    }
  }
}

function warnReaderDisposal(state: BrowserReaderState, message: string, reason: unknown): void {
  try {
    state.logger.warn(message, reason);
  } catch {
    // Logging must never interrupt the remaining reader release protocol.
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
