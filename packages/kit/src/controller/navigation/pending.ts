import type { Reader } from '@ritojs/core';
import type { NavigationDeps } from './index';
import { emitNavigationStart } from './start';
import {
  enqueueIntent,
  foregroundIsBusy,
  queuedSpreadTurn,
  type NavigationMachine,
  type PendingNavigation,
} from './machine';

/** Start the queued spread turn once its incoming content slot has been painted. */
export function continuePendingNavigation(
  machine: NavigationMachine,
  deps: NavigationDeps,
  spreadIndex: number,
): void {
  if (foregroundIsBusy(machine)) return;
  const pending = currentPending(machine, spreadIndex);
  if (!pending || pending.gesture?.cancelled) return;
  if (!ensureIncomingSlot(deps, pending.target, pending.direction)) {
    deps.frameDriver.scheduleComposite();
    return;
  }
  if (currentPending(machine, spreadIndex) !== pending) return;
  const reader = deps.getReader();
  if (!reader) return;
  enqueueIntent(machine, undefined);
  emitNavigationStart(
    machine,
    deps,
    reader,
    pending.attemptId,
    pending.target,
    pending.direction,
    pending.previous,
    pending.continuityDx,
    pending.gesture,
  );
}

export function ensureIncomingSlot(
  deps: NavigationDeps,
  spreadIndex: number,
  direction: 'forward' | 'backward',
): boolean {
  const slotPosition = direction === 'forward' ? 'next' : 'prev';
  if (deps.pool.getSlotFor(spreadIndex) !== slotPosition) {
    deps.pool.assignSlot(slotPosition, spreadIndex);
  }
  return deps.pool.ensureContent(slotPosition, deps.contentRenderer);
}

/** Clamp a requested spread index into the committed layout's final extent. */
export function navigationTarget(reader: Reader, requested: number): number {
  return Math.max(0, Math.min(requested, reader.totalSpreads - 1));
}

function currentPending(
  machine: NavigationMachine,
  spreadIndex: number,
): PendingNavigation | undefined {
  const pending = queuedSpreadTurn(machine);
  return pending?.attemptId === machine.claimSeq && pending.target === spreadIndex
    ? pending
    : undefined;
}
