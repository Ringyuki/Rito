import type { PageBufferPoolState } from './buffer-pool-state';
import type { DrawBufferSlot, PageBufferPool } from './buffer-pool';
import type { ProvisionalBufferStage } from './types';
import {
  incomingPosition,
  oppositeDirection,
  ownedProvisional,
  releaseCommittedProvisional,
  resetToProvisionalMount,
  rotateProvisional,
  swapVisualBuffers,
  type ProvisionalBufferOperations,
} from './buffer-pool-provisional-support';

type ProvisionalMethods = Pick<
  PageBufferPool,
  | 'beginProvisionalStage'
  | 'ensureProvisionalStage'
  | 'refreshProvisionalStage'
  | 'resolveDrawSlot'
  | 'notifyProvisionalComposite'
  | 'commitProvisionalStage'
  | 'beginProvisionalRollback'
  | 'completeProvisionalRollback'
  | 'finishProvisionalStage'
  | 'promoteProvisionalExact'
  | 'finishSameSpreadProvisionalExact'
  | 'containProvisionalFailure'
  | 'resetProvisionalState'
  | 'cancelProvisionalStage'
>;

export function createProvisionalMethods(
  state: PageBufferPoolState,
  operations: ProvisionalBufferOperations,
): ProvisionalMethods {
  return {
    ...createStageLifecycleMethods(state, operations),
    ...createStagePaintMethods(state, operations),
    ...createDrawMethods(state, operations),
    ...createCommitMethods(state, operations),
    ...createRollbackMethods(state, operations),
    ...createPromotionMethods(state, operations),
    ...createContainmentMethods(state, operations),
  };
}

function createStageLifecycleMethods(
  state: PageBufferPoolState,
  operations: ProvisionalBufferOperations,
): Pick<ProvisionalMethods, 'beginProvisionalStage' | 'cancelProvisionalStage'> {
  return {
    beginProvisionalStage(mountSpreadIndex, direction, onFirstComposite): ProvisionalBufferStage {
      if (state.disposed) {
        throw new Error('Cannot stage preview in a disposed page buffer pool');
      }
      if (state.provisional) {
        throw new Error('Cannot replace an owned provisional page buffer stage');
      }
      operations.clearSlot(state.provisionalSlot);
      const provisional = {
        token: ++state.nextProvisionalToken,
        mountSpreadIndex,
        direction,
        slot: state.provisionalSlot,
        onFirstComposite,
        phase: 'incoming' as const,
        rollbackSlot: undefined,
        compositeNotified: false,
      };
      state.provisional = provisional;
      return provisional;
    },
    cancelProvisionalStage(token): boolean {
      const provisional = ownedProvisional(state, token);
      if (!provisional || provisional.phase !== 'incoming') return false;
      operations.clearSlot(provisional.slot);
      state.provisional = undefined;
      return true;
    },
  };
}

function createStagePaintMethods(
  state: PageBufferPoolState,
  operations: ProvisionalBufferOperations,
): Pick<ProvisionalMethods, 'ensureProvisionalStage' | 'refreshProvisionalStage'> {
  return {
    ensureProvisionalStage(token, renderer): boolean {
      const provisional = ownedProvisional(state, token);
      if (!provisional || provisional.phase !== 'incoming') return false;
      const slot = provisional.slot;
      if (!slot.contentDirty) return true;
      const ctx = slot.content.getContext('2d');
      if (!ctx || !renderer(ctx)) return false;
      slot.contentDirty = false;
      slot.overlayDirty = false;
      slot.overlay = null;
      return true;
    },
    refreshProvisionalStage(token, renderer): boolean {
      const provisional = ownedProvisional(state, token);
      if (!provisional) return false;
      const slot =
        provisional.phase === 'incoming' ? provisional.slot : operations.getSlot(state, 'curr');
      const ctx = slot.content.getContext('2d');
      if (!ctx || !renderer(ctx)) return false;
      slot.contentDirty = false;
      slot.overlayDirty = false;
      slot.overlay = null;
      return true;
    },
  };
}

function createDrawMethods(
  state: PageBufferPoolState,
  operations: ProvisionalBufferOperations,
): Pick<ProvisionalMethods, 'resolveDrawSlot' | 'notifyProvisionalComposite'> {
  return {
    resolveDrawSlot(position): DrawBufferSlot {
      const provisional = state.provisional;
      if (provisional && provisional.phase !== 'incoming' && position === 'curr') {
        return {
          slot: operations.getSlot(state, 'curr'),
          provisional: true,
          provisionalToken: provisional.token,
        };
      }
      if (
        provisional?.phase === 'incoming' &&
        incomingPosition(provisional.direction) === position
      ) {
        return {
          slot: provisional.slot,
          provisional: true,
          provisionalToken: provisional.token,
        };
      }
      return { slot: operations.getSlot(state, position), provisional: false };
    },
    notifyProvisionalComposite(token): boolean {
      const provisional = ownedProvisional(state, token);
      if (!provisional || provisional.compositeNotified) return false;
      provisional.compositeNotified = true;
      try {
        provisional.onFirstComposite?.();
      } catch {
        // The display frame is already committed; an advisory host callback cannot poison it.
      }
      return true;
    },
  };
}

function createCommitMethods(
  state: PageBufferPoolState,
  operations: ProvisionalBufferOperations,
): Pick<ProvisionalMethods, 'commitProvisionalStage' | 'finishProvisionalStage'> {
  return {
    commitProvisionalStage(token): boolean {
      const provisional = ownedProvisional(state, token);
      if (!provisional || provisional.phase !== 'incoming') return false;
      const current = operations.getSlot(state, 'curr');
      if (current.spreadIndex !== provisional.mountSpreadIndex) return false;
      const incoming = operations.getSlot(state, incomingPosition(provisional.direction));
      swapVisualBuffers(incoming, provisional.slot);
      incoming.spreadIndex = provisional.mountSpreadIndex;
      incoming.contentDirty = false;
      incoming.overlay = null;
      incoming.overlayDirty = false;
      provisional.slot.spreadIndex = null;
      rotateProvisional(state, provisional.direction, operations);
      provisional.rollbackSlot = current;
      provisional.phase = 'committed';
      return true;
    },
    finishProvisionalStage(token): boolean {
      const provisional = ownedProvisional(state, token);
      if (!provisional || provisional.phase === 'incoming') return false;
      releaseCommittedProvisional(state, provisional, operations);
      return true;
    },
  };
}

function createRollbackMethods(
  state: PageBufferPoolState,
  operations: ProvisionalBufferOperations,
): Pick<ProvisionalMethods, 'beginProvisionalRollback' | 'completeProvisionalRollback'> {
  return {
    beginProvisionalRollback(token): boolean {
      const provisional = ownedProvisional(state, token);
      if (!provisional || provisional.phase !== 'committed') return false;
      const rollback = operations.getSlot(
        state,
        incomingPosition(oppositeDirection(provisional.direction)),
      );
      if (rollback !== provisional.rollbackSlot) return false;
      provisional.phase = 'rollingBack';
      return true;
    },
    completeProvisionalRollback(token): boolean {
      const provisional = ownedProvisional(state, token);
      if (!provisional || provisional.phase !== 'rollingBack') return false;
      const previewSlot = operations.getSlot(state, 'curr');
      rotateProvisional(state, oppositeDirection(provisional.direction), operations);
      operations.clearSlot(previewSlot);
      operations.clearSlot(provisional.slot);
      state.provisional = undefined;
      return true;
    },
  };
}

function createPromotionMethods(
  state: PageBufferPoolState,
  operations: ProvisionalBufferOperations,
): Pick<ProvisionalMethods, 'promoteProvisionalExact' | 'finishSameSpreadProvisionalExact'> {
  return {
    promoteProvisionalExact(token, position, exactSpreadIndex): boolean {
      const provisional = ownedProvisional(state, token);
      if (
        !provisional ||
        provisional.phase !== 'committed' ||
        position !== incomingPosition(provisional.direction)
      ) {
        return false;
      }
      const exactSlot = operations.getSlot(state, position);
      if (
        exactSlot === provisional.rollbackSlot ||
        exactSlot.spreadIndex !== exactSpreadIndex ||
        exactSlot.contentDirty
      ) {
        return false;
      }
      const previewSlot = operations.getSlot(state, 'curr');
      rotateProvisional(state, provisional.direction, operations);
      operations.clearSlot(previewSlot);
      releaseCommittedProvisional(state, provisional, operations);
      return true;
    },
    finishSameSpreadProvisionalExact(token, exactSpreadIndex): boolean {
      const provisional = ownedProvisional(state, token);
      const current = operations.getSlot(state, 'curr');
      if (
        !provisional ||
        provisional.phase !== 'committed' ||
        current.spreadIndex !== exactSpreadIndex ||
        current.contentDirty
      ) {
        return false;
      }
      releaseCommittedProvisional(state, provisional, operations);
      return true;
    },
  };
}

function createContainmentMethods(
  state: PageBufferPoolState,
  operations: ProvisionalBufferOperations,
): Pick<ProvisionalMethods, 'containProvisionalFailure' | 'resetProvisionalState'> {
  return {
    containProvisionalFailure(token, fallbackMountSpreadIndex): boolean {
      if (state.disposed) return false;
      const provisional = ownedProvisional(state, token);
      if (!provisional) {
        resetToProvisionalMount(state, fallbackMountSpreadIndex, operations);
        return false;
      }
      if (provisional.phase === 'incoming') {
        operations.clearSlot(provisional.slot);
        state.provisional = undefined;
        return true;
      }
      const rollback = provisional.rollbackSlot;
      const position = incomingPosition(oppositeDirection(provisional.direction));
      if (rollback && operations.getSlot(state, position) === rollback) {
        const preview = operations.getSlot(state, 'curr');
        rotateProvisional(state, oppositeDirection(provisional.direction), operations);
        if (operations.getSlot(state, 'curr') === rollback) {
          operations.clearSlot(preview);
          operations.clearSlot(provisional.slot);
          state.provisional = undefined;
          return true;
        }
      }
      resetToProvisionalMount(state, provisional.mountSpreadIndex, operations);
      return false;
    },
    resetProvisionalState(fallbackMountSpreadIndex): void {
      if (state.disposed) return;
      resetToProvisionalMount(state, fallbackMountSpreadIndex, operations);
    },
  };
}
