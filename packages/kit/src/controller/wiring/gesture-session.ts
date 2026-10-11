import type { TransitionTouch } from '../../driver/effects';
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
  return {
    token: null,
    started: false,
    status: 'active',
    latestDx: dx,
    latestTimestamp: timestamp,
    latestTouch: touch,
  };
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
  session.latestTouch = touch;
}

/** Hands the driver the gesture's latest sample: how far, when, and where the finger is. */
export function applyGestureSample(context: GestureSessionContext, session: GestureSession): void {
  context.deps.td.updateTracking(session.latestDx, session.latestTimestamp, session.latestTouch);
}
