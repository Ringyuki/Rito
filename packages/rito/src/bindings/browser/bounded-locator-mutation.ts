import type { ReaderLocator, ReaderLocatorResolution } from '../../reader';
import type { BrowserReaderBoundedReplacementTarget } from './bounded-font-geometry';
import type { BrowserReaderBoundedSnapshot } from './core-contracts';
import { enqueueBrowserReaderCurrentMutation } from './current-mutation-queue';
import {
  fallbackReaderLocatorForOutcome,
  type ReaderLocatorTargetOutcome,
} from './locator-precision';
import {
  rejectLocatorRequest,
  resolveLocatorRequest,
  resolveLocatorSnapshot,
  type LocatorRequestSettlement,
} from './bounded-locator-settlement';
import type { BrowserReaderBoundedSessionOwner } from './reader-session-host';
import type { BrowserReaderState } from './reader/types';

type LocatorMutation = (
  target: (owner: BrowserReaderBoundedSessionOwner) => Promise<BrowserReaderBoundedSnapshot>,
  replacementTarget: () => BrowserReaderBoundedReplacementTarget,
  isCurrent: () => boolean,
  whenSuperseded: () => Promise<void>,
) => Promise<BrowserReaderBoundedSnapshot | undefined>;

interface LocatorRequest extends LocatorRequestSettlement {
  readonly locator: ReaderLocator;
  readonly mutate: LocatorMutation;
  readonly onTargetStarted: (() => void) | undefined;
  readonly onCancelled: (() => void) | undefined;
  readonly promise: Promise<ReaderLocatorResolution | undefined>;
}

export interface BrowserReaderBoundedLocatorLifecycle {
  readonly onTargetStarted?: (() => void) | undefined;
  readonly onCancelled?: (() => void) | undefined;
}

interface LocatorCoordinator {
  phase: 'idle' | 'queued' | 'targeting' | 'settling';
  scheduled: boolean;
  current: LocatorRequest | undefined;
  pending: LocatorRequest | undefined;
  owner: BrowserReaderBoundedSessionOwner | undefined;
  targetSequence: number;
  targetTask: Promise<ReaderLocatorTargetOutcome> | undefined;
  targetLocator: ReaderLocator | undefined;
  targetChanged: Promise<void> | undefined;
  wakeTarget: (() => void) | undefined;
}

const locatorCoordinators = new WeakMap<BrowserReaderState, LocatorCoordinator>();

export function ensureCoalescedBrowserReaderBoundedLocator(
  state: BrowserReaderState,
  locator: ReaderLocator,
  signal: AbortSignal | undefined,
  mutate: LocatorMutation,
  lifecycle: BrowserReaderBoundedLocatorLifecycle = {},
): Promise<ReaderLocatorResolution | undefined> {
  if (state.disposed || signal?.aborted) return Promise.resolve(undefined);
  const coordinator = locatorCoordinator(state);
  const request = createLocatorRequest(state, coordinator, locator, signal, mutate, lifecycle);
  submitLocatorRequest(state, coordinator, request);
  return request.promise;
}

function locatorCoordinator(state: BrowserReaderState): LocatorCoordinator {
  const existing = locatorCoordinators.get(state);
  if (existing) return existing;
  const created: LocatorCoordinator = {
    phase: 'idle',
    scheduled: false,
    current: undefined,
    pending: undefined,
    owner: undefined,
    targetSequence: 0,
    targetTask: undefined,
    targetLocator: undefined,
    targetChanged: undefined,
    wakeTarget: undefined,
  };
  locatorCoordinators.set(state, created);
  return created;
}

function createLocatorRequest(
  state: BrowserReaderState,
  coordinator: LocatorCoordinator,
  locator: ReaderLocator,
  signal: AbortSignal | undefined,
  mutate: LocatorMutation,
  lifecycle: BrowserReaderBoundedLocatorLifecycle,
): LocatorRequest {
  let resolvePromise!: (value: ReaderLocatorResolution | undefined) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<ReaderLocatorResolution | undefined>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const request: LocatorRequest = {
    locator,
    mutate,
    onTargetStarted: lifecycle.onTargetStarted,
    onCancelled: lifecycle.onCancelled,
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
    settled: false,
    stopWatchingAbort: undefined,
  };
  if (signal) {
    const abort = (): void => {
      cancelLocatorRequest(state, coordinator, request);
    };
    signal.addEventListener('abort', abort, { once: true });
    request.stopWatchingAbort = () => {
      signal.removeEventListener('abort', abort);
    };
    if (signal.aborted) abort();
  }
  return request;
}

function submitLocatorRequest(
  state: BrowserReaderState,
  coordinator: LocatorCoordinator,
  request: LocatorRequest,
): void {
  if (request.settled || state.disposed) {
    resolveLocatorRequest(request, undefined);
    return;
  }
  if (coordinator.phase === 'targeting' && coordinator.owner) {
    resolveLocatorRequest(coordinator.current, undefined);
    coordinator.current = request;
    startLocatorTarget(coordinator, coordinator.owner, request);
    return;
  }
  if (coordinator.phase === 'settling') {
    resolveLocatorRequest(coordinator.current, undefined);
  }
  replacePendingLocator(coordinator, request);
  scheduleLocatorPump(state, coordinator);
}

function replacePendingLocator(coordinator: LocatorCoordinator, request: LocatorRequest): void {
  resolveLocatorRequest(coordinator.pending, undefined);
  coordinator.pending = request;
  if (coordinator.phase === 'idle') coordinator.phase = 'queued';
}

function scheduleLocatorPump(state: BrowserReaderState, coordinator: LocatorCoordinator): void {
  if (coordinator.scheduled) return;
  coordinator.scheduled = true;
  void enqueueBrowserReaderCurrentMutation(state, async () => {
    try {
      await runLocatorPump(state, coordinator);
    } finally {
      coordinator.scheduled = false;
      coordinator.phase = coordinator.pending ? 'queued' : 'idle';
      if (coordinator.pending) scheduleLocatorPump(state, coordinator);
    }
  });
}

async function runLocatorPump(
  state: BrowserReaderState,
  coordinator: LocatorCoordinator,
): Promise<void> {
  while (coordinator.pending) {
    const request = coordinator.pending;
    coordinator.pending = undefined;
    if (state.disposed || request.settled) {
      resolveLocatorRequest(request, undefined);
      continue;
    }
    coordinator.current = request;
    try {
      const snapshot = await request.mutate(
        (owner) => targetLatestLocator(coordinator, owner),
        () => replacementTarget(state, coordinator),
        () => coordinator.current !== undefined && !coordinator.current.settled,
        () => whenCurrentLocatorSettles(coordinator),
      );
      resolveLocatorSnapshot(coordinator.current, snapshot);
    } catch (error) {
      rejectLocatorRequest(coordinator.current, error);
    } finally {
      coordinator.current = undefined;
      coordinator.owner = undefined;
      coordinator.targetTask = undefined;
      coordinator.targetLocator = undefined;
      coordinator.targetChanged = undefined;
      coordinator.wakeTarget = undefined;
      coordinator.phase = 'idle';
    }
  }
}

function whenCurrentLocatorSettles(coordinator: LocatorCoordinator): Promise<void> {
  const request = coordinator.current;
  if (!request || request.settled) return Promise.resolve();
  return request.promise.then(
    () => undefined,
    () => undefined,
  );
}

async function targetLatestLocator(
  coordinator: LocatorCoordinator,
  owner: BrowserReaderBoundedSessionOwner,
): Promise<BrowserReaderBoundedSnapshot> {
  coordinator.phase = 'targeting';
  coordinator.owner = owner;
  const request = coordinator.current;
  if (!request) throw new Error('Bounded reader locator mutation lost its current request');
  startLocatorTarget(coordinator, owner, request);
  for (;;) {
    const sequence = coordinator.targetSequence;
    const task = coordinator.targetTask;
    const targetChanged = coordinator.targetChanged;
    if (!task || !targetChanged) {
      throw new Error('Bounded reader locator mutation lost its target task');
    }
    const outcome = await Promise.race([task, targetChanged.then(() => undefined)]);
    if (sequence !== coordinator.targetSequence || !outcome) continue;
    const fallback = fallbackReaderLocatorForOutcome(coordinator.targetLocator, outcome);
    if (fallback) {
      startLocatorValueTarget(coordinator, owner, fallback);
      continue;
    }
    coordinator.phase = 'settling';
    if (outcome.kind === 'error') {
      throw outcome.error;
    }
    return outcome.snapshot;
  }
}

function startLocatorTarget(
  coordinator: LocatorCoordinator,
  owner: BrowserReaderBoundedSessionOwner,
  request: LocatorRequest,
): void {
  request.onTargetStarted?.();
  startLocatorValueTarget(coordinator, owner, request.locator);
}

function startLocatorValueTarget(
  coordinator: LocatorCoordinator,
  owner: BrowserReaderBoundedSessionOwner,
  locator: ReaderLocator,
): void {
  coordinator.targetLocator = locator;
  startTarget(coordinator, () => owner.controller.ensureLocator(locator));
}

function startSpreadRecoveryTarget(
  coordinator: LocatorCoordinator,
  owner: BrowserReaderBoundedSessionOwner,
  spreadIndex: number,
): void {
  coordinator.targetLocator = undefined;
  startTarget(coordinator, () => owner.controller.ensureSpread(spreadIndex));
}

function startTarget(
  coordinator: LocatorCoordinator,
  target: () => Promise<BrowserReaderBoundedSnapshot>,
): void {
  coordinator.wakeTarget?.();
  coordinator.targetSequence += 1;
  coordinator.targetChanged = new Promise((resolve) => {
    coordinator.wakeTarget = resolve;
  });
  try {
    coordinator.targetTask = target().then(
      (snapshot) => ({ kind: 'snapshot' as const, snapshot }),
      (error: unknown) => ({ kind: 'error' as const, error }),
    );
  } catch (error) {
    coordinator.targetTask = Promise.resolve({ kind: 'error', error });
  }
}

function replacementTarget(
  state: BrowserReaderState,
  coordinator: LocatorCoordinator,
): BrowserReaderBoundedReplacementTarget {
  const request = coordinator.current;
  if (!request) throw new Error('Bounded reader locator mutation lost its replacement target');
  return {
    targetSpreadIndex: state.activeSpreadIndex,
    ...(!request.settled ? { preserveLocator: request.locator } : {}),
  };
}

function cancelLocatorRequest(
  state: BrowserReaderState,
  coordinator: LocatorCoordinator,
  request: LocatorRequest,
): void {
  if (coordinator.pending === request) coordinator.pending = undefined;
  request.onCancelled?.();
  resolveLocatorRequest(request, undefined);
  if (coordinator.current === request && coordinator.phase === 'targeting' && coordinator.owner) {
    startSpreadRecoveryTarget(coordinator, coordinator.owner, state.activeSpreadIndex);
  }
}
