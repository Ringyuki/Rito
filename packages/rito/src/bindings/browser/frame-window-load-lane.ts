import { trackBrowserReaderHostTask } from './reader-host-tasks';
import { isCurrentRevisionHandle } from './reader/pipeline/revision-handle';
import type { BrowserReaderRevisionHandle, BrowserReaderState } from './reader/types';

type FrameWindowLoadExecutor = (
  revision: BrowserReaderRevisionHandle,
  centerSpreadIndex: number,
) => Promise<void>;

type FrameWindowCompletionPredicate = (
  state: BrowserReaderState,
  revision: BrowserReaderRevisionHandle,
  centerSpreadIndex: number,
) => boolean;

interface FrameWindowLoadTicket {
  readonly revision: BrowserReaderRevisionHandle;
  readonly centerSpreadIndex: number;
  readonly execute: FrameWindowLoadExecutor;
  readonly isCompleted: FrameWindowCompletionPredicate;
  readonly task: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

interface FrameWindowLoadLane {
  active: FrameWindowLoadTicket | undefined;
  queued: FrameWindowLoadTicket | undefined;
}

const frameWindowLoadLanes = new WeakMap<BrowserReaderState, FrameWindowLoadLane>();

export function queueBrowserReaderFrameWindowLoad(
  state: BrowserReaderState,
  revision: BrowserReaderRevisionHandle,
  centerSpreadIndex: number,
  execute: FrameWindowLoadExecutor,
  isCompleted: FrameWindowCompletionPredicate,
): Promise<void> {
  const pending = state.pendingFrameLoads.get(centerSpreadIndex);
  if (pending) return pending;
  const ticket = createFrameWindowLoadTicket(
    state,
    revision,
    centerSpreadIndex,
    execute,
    isCompleted,
  );
  scheduleFrameWindowLoad(state, ticket);
  state.pendingFrameLoads.set(centerSpreadIndex, ticket.task);
  return ticket.task;
}

export function resetBrowserReaderFrameWindowLoadLane(state: BrowserReaderState): void {
  const lane = frameWindowLoadLanes.get(state);
  if (lane?.queued) {
    lane.queued.resolve();
    lane.queued = undefined;
  }
  state.pendingFrameLoads.clear();
}

function createFrameWindowLoadTicket(
  state: BrowserReaderState,
  revision: BrowserReaderRevisionHandle,
  centerSpreadIndex: number,
  execute: FrameWindowLoadExecutor,
  isCompleted: FrameWindowCompletionPredicate,
): FrameWindowLoadTicket {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const completion = new Promise<void>((resolveTicket, rejectTicket) => {
    resolve = resolveTicket;
    reject = rejectTicket;
  });
  const task: Promise<void> = trackBrowserReaderHostTask(state, completion).finally(() => {
    if (state.pendingFrameLoads.get(centerSpreadIndex) === task) {
      state.pendingFrameLoads.delete(centerSpreadIndex);
    }
  });
  const ticket = {
    revision,
    centerSpreadIndex,
    execute,
    isCompleted,
    task,
    resolve,
    reject,
  };
  return ticket;
}

function scheduleFrameWindowLoad(state: BrowserReaderState, ticket: FrameWindowLoadTicket): void {
  const lane = frameWindowLoadLane(state);
  if (!lane.active) {
    startFrameWindowLoad(state, lane, ticket);
    return;
  }
  replaceQueuedFrameWindowLoad(state, lane, ticket);
}

function startFrameWindowLoad(
  state: BrowserReaderState,
  lane: FrameWindowLoadLane,
  ticket: FrameWindowLoadTicket,
): void {
  if (
    !isCurrentRevisionHandle(state, ticket.revision) ||
    ticket.isCompleted(state, ticket.revision, ticket.centerSpreadIndex)
  ) {
    ticket.resolve();
    startQueuedFrameWindowLoad(state, lane);
    return;
  }
  lane.active = ticket;
  let request: Promise<void>;
  try {
    request = ticket.execute(ticket.revision, ticket.centerSpreadIndex);
  } catch (error: unknown) {
    finishFrameWindowLoad(state, lane, ticket, error);
    return;
  }
  void request.then(
    () => {
      finishFrameWindowLoad(state, lane, ticket);
    },
    (error: unknown) => {
      finishFrameWindowLoad(state, lane, ticket, error);
    },
  );
}

function finishFrameWindowLoad(
  state: BrowserReaderState,
  lane: FrameWindowLoadLane,
  ticket: FrameWindowLoadTicket,
  error?: unknown,
): void {
  if (lane.active !== ticket) return;
  lane.active = undefined;
  if (error === undefined) ticket.resolve();
  else ticket.reject(error);
  startQueuedFrameWindowLoad(state, lane);
}

function startQueuedFrameWindowLoad(state: BrowserReaderState, lane: FrameWindowLoadLane): void {
  const queued = lane.queued;
  if (!queued) return;
  lane.queued = undefined;
  startFrameWindowLoad(state, lane, queued);
}

function replaceQueuedFrameWindowLoad(
  state: BrowserReaderState,
  lane: FrameWindowLoadLane,
  ticket: FrameWindowLoadTicket,
): void {
  const replaced = lane.queued;
  lane.queued = ticket;
  if (!replaced) return;
  if (state.pendingFrameLoads.get(replaced.centerSpreadIndex) === replaced.task) {
    state.pendingFrameLoads.delete(replaced.centerSpreadIndex);
  }
  replaced.resolve();
}

function frameWindowLoadLane(state: BrowserReaderState): FrameWindowLoadLane {
  const current = frameWindowLoadLanes.get(state);
  if (current) return current;
  const created: FrameWindowLoadLane = { active: undefined, queued: undefined };
  frameWindowLoadLanes.set(state, created);
  return created;
}
