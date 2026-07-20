import type { PageBufferPoolState } from './buffer-pool-state';
import type { PageBufferSlot, SlotPosition } from './types';

export interface ProvisionalBufferOperations {
  readonly getSlot: (state: PageBufferPoolState, position: SlotPosition) => PageBufferSlot;
  readonly clearSlot: (slot: PageBufferSlot) => void;
  readonly assignSlot: (
    state: PageBufferPoolState,
    position: SlotPosition,
    spreadIndex: number,
  ) => void;
  readonly rotateForward: (state: PageBufferPoolState) => void;
  readonly rotateBackward: (state: PageBufferPoolState) => void;
}

export function releaseCommittedProvisional(
  state: PageBufferPoolState,
  provisional: NonNullable<PageBufferPoolState['provisional']>,
  operations: ProvisionalBufferOperations,
): void {
  const rollback = provisional.rollbackSlot;
  if (rollback && rollback !== operations.getSlot(state, 'curr')) {
    operations.clearSlot(rollback);
  }
  operations.clearSlot(provisional.slot);
  state.provisional = undefined;
}

export function resetToProvisionalMount(
  state: PageBufferPoolState,
  mountSpreadIndex: number,
  operations: ProvisionalBufferOperations,
): void {
  for (const slot of state.slots) operations.clearSlot(slot);
  operations.clearSlot(state.provisionalSlot);
  state.indices = [0, 1, 2];
  state.provisional = undefined;
  operations.assignSlot(state, 'curr', mountSpreadIndex);
}

export function ownedProvisional(
  state: PageBufferPoolState,
  token: number,
): PageBufferPoolState['provisional'] {
  const provisional = state.provisional;
  return provisional?.token === token ? provisional : undefined;
}

export function incomingPosition(direction: 'forward' | 'backward'): 'next' | 'prev' {
  return direction === 'forward' ? 'next' : 'prev';
}

export function oppositeDirection(direction: 'forward' | 'backward'): 'forward' | 'backward' {
  return direction === 'forward' ? 'backward' : 'forward';
}

export function rotateProvisional(
  state: PageBufferPoolState,
  direction: 'forward' | 'backward',
  operations: ProvisionalBufferOperations,
): void {
  if (direction === 'forward') operations.rotateForward(state);
  else operations.rotateBackward(state);
}

export function swapVisualBuffers(left: PageBufferSlot, right: PageBufferSlot): void {
  const content = left.content;
  const overlay = left.overlay;
  const contentDirty = left.contentDirty;
  const overlayDirty = left.overlayDirty;
  Object.assign(left, {
    content: right.content,
    overlay: right.overlay,
    contentDirty: right.contentDirty,
    overlayDirty: right.overlayDirty,
  });
  Object.assign(right, { content, overlay, contentDirty, overlayDirty });
}
