import type { TransitionTouch } from '../../driver/effects';
import type { FrameDriver } from '../../driver/frame-driver';
import type { TransitionDriver } from '../../driver/transition-driver';

export interface GestureSessionContext {
  readonly deps: {
    readonly td: TransitionDriver;
    readonly frameDriver: FrameDriver;
  };
  /** Whether a finger is turning the page: it came down, and went the way pages turn. */
  turningByFinger: boolean;
}

/**
 * A finger went far enough the way pages turn to mean a drag: the engine is
 * told where it took hold and where it is. A turn on screen is the engine's
 * to cut into; a page not yet painted is the engine's to wait for.
 */
export function beginFingerTurn(
  context: GestureSessionContext,
  travel: number,
  timestamp: number,
  touch: TransitionTouch,
): void {
  context.turningByFinger = true;
  context.deps.td.fingerDown(touch.origin, timestamp);
  context.deps.td.fingerMove(touch.position, travel, timestamp);
  context.deps.frameDriver.scheduleComposite();
}

export function updateGesture(
  context: GestureSessionContext,
  travel: number,
  timestamp: number,
  touch: TransitionTouch,
): void {
  if (!context.turningByFinger) return;
  context.deps.td.fingerMove(touch.position, travel, timestamp);
  context.deps.frameDriver.scheduleComposite();
}

export function finishGesture(
  context: GestureSessionContext,
  travel: number,
  timestamp: number,
  touch: TransitionTouch,
): void {
  if (!context.turningByFinger) return;
  context.turningByFinger = false;
  context.deps.td.fingerUp(touch.position, travel, timestamp);
  context.deps.frameDriver.scheduleComposite();
}

/** The finger was taken away: the engine sends back a page it held. */
export function cancelGestureSession(context: GestureSessionContext): void {
  if (!context.turningByFinger) return;
  context.turningByFinger = false;
  context.deps.td.fingerCancel();
}
