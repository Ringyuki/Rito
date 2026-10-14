import type { TransitionPoint, TransitionTouch } from '../../driver/effects';
import type { FrameDriver } from '../../driver/frame-driver';
import type { TransitionDriver } from '../../driver/transition-driver';
import type { GestureNavigationToken } from '../navigation/index';

export interface GestureSession {
  token: GestureNavigationToken | null;
  started: boolean;
  status: 'active' | 'ended' | 'cancelled';
  latestDx: number;
  latestTimestamp: number;
  latestTouch: TransitionTouch | undefined;
  /** Whether the drag first moved toward the next spread: the way its turn goes. */
  readonly forward: boolean;
  /**
   * How far the finger had carried the turn at its farthest that way, and
   * where it was then. It is kept here because a turn whose neighbour is
   * not ready yet takes no samples: only the latest is handed over.
   */
  farthest: { readonly dx: number; readonly at: TransitionPoint } | null;
}

export interface GestureSessionContext {
  readonly deps: {
    readonly td: TransitionDriver;
    readonly frameDriver: FrameDriver;
  };
  gesture: GestureSession | null;
  ownsTransition: boolean;
}

export function createGestureSession(
  dx: number,
  timestamp: number,
  touch?: TransitionTouch,
): GestureSession {
  const session: GestureSession = {
    token: null,
    started: false,
    status: 'active',
    latestDx: dx,
    latestTimestamp: timestamp,
    latestTouch: undefined,
    forward: dx < 0,
    farthest: null,
  };
  updateGestureSample(session, dx, timestamp, touch);
  return session;
}

export function watchOwnedTransition(context: GestureSessionContext): () => void {
  return context.deps.td.onSettled(() => {
    if (!context.ownsTransition) return;
    context.ownsTransition = false;
    if (context.gesture?.started) context.gesture = null;
  });
}

export function activateGestureTransition(
  context: GestureSessionContext,
  session: GestureSession,
): void {
  if (context.gesture !== session || session.status === 'cancelled') return;
  session.started = true;
  session.token = null;
  context.ownsTransition = true;
  context.deps.td.interrupt(session.latestTimestamp);
  applyGestureSample(context, session);
  if (session.status === 'ended') {
    context.deps.td.releaseTracking();
    context.gesture = null;
  }
  context.deps.frameDriver.scheduleComposite();
}

export function updateGesture(
  context: GestureSessionContext,
  dx: number,
  timestamp: number,
  touch?: TransitionTouch,
): void {
  const session = context.gesture;
  if (!session) return;
  updateGestureSample(session, dx, timestamp, touch);
  if (session.started) applyGestureSample(context, session);
  context.deps.frameDriver.scheduleComposite();
}

export function finishGesture(
  context: GestureSessionContext,
  dx: number,
  timestamp: number,
  touch?: TransitionTouch,
): void {
  const session = context.gesture;
  if (!session) return;
  updateGestureSample(session, dx, timestamp, touch);
  session.status = 'ended';
  if (session.started) {
    applyGestureSample(context, session);
    context.deps.td.releaseTracking();
    context.gesture = null;
  }
  context.deps.frameDriver.scheduleComposite();
}

export function cancelGestureSession(context: GestureSessionContext): void {
  const session = context.gesture;
  if (session) {
    session.status = 'cancelled';
    session.token?.cancel();
    context.gesture = null;
  }
  if (context.ownsTransition) context.deps.td.cancelTracking();
}

export function cancelDeferredGesture(context: GestureSessionContext): void {
  const session = context.gesture;
  if (!session || session.started) return;
  session.status = 'cancelled';
  session.token?.cancel();
  context.gesture = null;
}

export function settleOwnedTransition(context: GestureSessionContext): void {
  if (!context.ownsTransition) return;
  context.deps.td.cancelTracking();
  context.deps.td.forceSettle();
  context.ownsTransition = false;
}

function updateGestureSample(
  session: GestureSession,
  dx: number,
  timestamp: number,
  touch: TransitionTouch | undefined,
): void {
  session.latestDx = dx;
  session.latestTimestamp = timestamp;
  session.latestTouch = touch && withFarthest(session, dx, touch);
}

/** The finger, with where it was when it had carried the turn farthest the way the turn goes. */
function withFarthest(
  session: GestureSession,
  dx: number,
  touch: TransitionTouch,
): TransitionTouch {
  const far = session.farthest;
  const farther = !far || (session.forward ? dx < far.dx : dx > far.dx);
  const farthest = farther ? { dx, at: touch.position } : far;
  session.farthest = farthest;
  return { origin: touch.origin, position: touch.position, farthest: farthest.at };
}

/** Hands the driver the gesture's latest sample: how far, when, and where the finger is. */
export function applyGestureSample(context: GestureSessionContext, session: GestureSession): void {
  context.deps.td.updateTracking(session.latestDx, session.latestTimestamp, session.latestTouch);
}
