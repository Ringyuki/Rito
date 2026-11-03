import type { FrameDriver, FrameDriverState } from './frame-driver';

/** The frame driver's holds: the first composite held back, and every one while suspended. */
export function compositeHolds(
  state: FrameDriverState,
  driver: () => FrameDriver,
): Pick<FrameDriver, 'holdFirstComposite' | 'suspend'> {
  return {
    holdFirstComposite(): (() => void) | null {
      return holdFirstComposite(driver(), state);
    },
    suspend(): () => void {
      return suspendComposites(state);
    },
  };
}

function holdFirstComposite(driver: FrameDriver, state: FrameDriverState): (() => void) | null {
  if (state.disposed || state.firstCompositeStarted) return null;
  state.firstCompositeHoldCount += 1;
  if (state.rafId !== null) {
    cancelScheduledFrame(state);
    requestHeldComposite(state, 'scheduled');
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseFirstCompositeHold(driver, state);
  };
}

function suspendComposites(state: FrameDriverState): () => void {
  state.suspendCount += 1;
  cancelScheduledFrame(state);
  state.heldCompositeRequest = 'none';
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.suspendCount -= 1;
  };
}

export function requestHeldComposite(
  state: FrameDriverState,
  request: Exclude<FrameDriverState['heldCompositeRequest'], 'none'>,
): void {
  if (request === 'immediate' || state.heldCompositeRequest === 'none') {
    state.heldCompositeRequest = request;
  }
}

function releaseFirstCompositeHold(driver: FrameDriver, state: FrameDriverState): void {
  state.firstCompositeHoldCount = Math.max(0, state.firstCompositeHoldCount - 1);
  if (state.firstCompositeHoldCount > 0 || state.disposed) return;
  const request = state.heldCompositeRequest;
  state.heldCompositeRequest = 'none';
  if (request === 'immediate') driver.compositeNow();
  else if (request === 'scheduled') driver.scheduleComposite();
}

export function cancelScheduledFrame(state: FrameDriverState): void {
  if (state.rafId === null) return;
  cancelAnimationFrame(state.rafId);
  state.rafId = null;
}
