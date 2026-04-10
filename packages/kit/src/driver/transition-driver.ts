import { rubberBand } from './rubber-band';
import {
  getSlotPositions,
  stepSettling,
  stepBoundaryElastic,
  forceSettleMode,
} from './transition-steps';
import type {
  DrawInstruction,
  SettledEvent,
  TransitionDriverOptions,
  TransitionMode,
} from './types';
import { DEFAULT_TRANSITION_OPTIONS } from './types';

/**
 * Pure JS transition state machine with spring physics.
 * Does NOT import any DOM types — entirely testable in Node.
 */
export interface TransitionDriver {
  /** Current mode. */
  readonly mode: TransitionMode;
  /** Whether any animation is in progress. */
  readonly isAnimating: boolean;
  /** The viewport width used for displacement calculations. */
  viewportWidth: number;

  /** Begin gesture tracking after direction lock. */
  startTracking(
    direction: 'forward' | 'backward',
    outgoingSpread: number,
    incomingSpread: number | null,
    timestamp: number,
  ): void;

  /** Update tracking position during gesture. */
  updateTracking(rawDx: number, timestamp: number): void;

  /**
   * Release tracking (touchend). Returns whether the transition commits or cancels.
   * Transitions to 'settling' or 'boundary-elastic'.
   */
  releaseTracking(): 'commit' | 'cancel';

  /** Programmatic navigation (keyboard, TOC). Goes directly to settling. */
  goToTarget(
    direction: 'forward' | 'backward',
    outgoingSpread: number,
    incomingSpread: number | null,
    initialDx?: number,
  ): void;

  /** Interrupt a settling animation to resume tracking. Preserves dx/vx. */
  interrupt(timestamp: number): { dx: number; vx: number } | null;

  /** Advance one frame. Returns what to draw. `dt` is in milliseconds. */
  step(dt: number): DrawInstruction;

  /**
   * Instantly complete the current animation: snap dx to target, trigger onSettled.
   * Returns the residual dx at the moment of force-settle (for visual continuity).
   */
  forceSettle(): number;

  /** Update spring/swipe parameters at runtime. */
  configure(update: Partial<TransitionDriverOptions>): void;

  /** Force back to idle without triggering onSettled. */
  reset(): void;

  /** Register callback for when settling completes. */
  onSettled(cb: (event: SettledEvent) => void): () => void;
}

/** Sliding window for velocity estimation. Keeps N most recent (dx, timestamp) samples. */
const VELOCITY_WINDOW_SIZE = 5;
/** Time horizon (ms) for projecting current velocity into commit decision. */
const PROJECTION_MS = 150;

interface VelocitySample {
  dx: number;
  timestamp: number;
}

function estimateVelocity(samples: VelocitySample[]): number {
  if (samples.length < 2) return 0;
  const newest = samples[samples.length - 1];
  const oldest = samples[0];
  if (!newest || !oldest) return 0;
  const dt = newest.timestamp - oldest.timestamp;
  if (dt < 1) return 0;

  // Time-weighted: give more weight to recent samples
  let weightedVx = 0;
  let totalWeight = 0;
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const curr = samples[i];
    if (!prev || !curr) continue;
    const segDt = Math.max(curr.timestamp - prev.timestamp, 1);
    const segVx = (curr.dx - prev.dx) / segDt;
    const weight = i; // Later samples get higher weight
    weightedVx += segVx * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? weightedVx / totalWeight : 0;
}

export function createTransitionDriver(
  options?: Partial<TransitionDriverOptions>,
): TransitionDriver {
  let opts: TransitionDriverOptions = { ...DEFAULT_TRANSITION_OPTIONS, ...options };
  let mode: TransitionMode = { kind: 'idle' };
  let W = 0;
  const settledListeners = new Set<(event: SettledEvent) => void>();
  let velocitySamples: VelocitySample[] = [];

  function emitSettled(event: SettledEvent): void {
    for (const cb of settledListeners) cb(event);
  }

  const driver: TransitionDriver = {
    get mode() {
      return mode;
    },
    get isAnimating() {
      return mode.kind !== 'idle';
    },
    get viewportWidth() {
      return W;
    },
    set viewportWidth(w: number) {
      W = w;
    },

    startTracking(direction, outgoingSpread, incomingSpread, timestamp): void {
      velocitySamples = [{ dx: 0, timestamp }];
      mode = {
        kind: 'tracking',
        direction,
        outgoingSpread,
        incomingSpread,
        dx: 0,
        vx: 0,
        lastSampleAt: timestamp,
      };
    },

    updateTracking(rawDx, timestamp): void {
      if (mode.kind !== 'tracking') return;

      const dx = mode.incomingSpread === null ? rubberBand(rawDx, W, opts.elasticFactor) : rawDx;

      velocitySamples.push({ dx, timestamp });
      if (velocitySamples.length > VELOCITY_WINDOW_SIZE) {
        velocitySamples.shift();
      }
      mode.vx = estimateVelocity(velocitySamples);
      mode.dx = dx;
      mode.lastSampleAt = timestamp;
    },

    releaseTracking(): 'commit' | 'cancel' {
      if (mode.kind !== 'tracking') return 'cancel';

      const { direction, outgoingSpread, incomingSpread, dx, vx } = mode;

      // Boundary elastic — always cancel (spring back to 0)
      if (incomingSpread === null) {
        mode = { kind: 'boundary-elastic', slotSpread: outgoingSpread, dx, vx };
        return 'cancel';
      }

      // Cancel if position OR velocity indicates the user is pulling back
      const dxReversed =
        (direction === 'forward' && dx > 0) || (direction === 'backward' && dx < 0);
      const pullingBack =
        (direction === 'forward' && vx > 0.05) || (direction === 'backward' && vx < -0.05);
      if (dxReversed || pullingBack) {
        mode = { kind: 'settling', direction, outgoingSpread, incomingSpread, target: 0, dx, vx };
        return 'cancel';
      }

      // Commit decision: project current position + velocity forward in time.
      const projected = Math.abs(dx + vx * PROJECTION_MS);
      const committed = projected > opts.swipeThreshold || Math.abs(vx) > opts.velocityCommit;
      const target = committed ? (direction === 'forward' ? -W : W) : 0;
      mode = { kind: 'settling', direction, outgoingSpread, incomingSpread, target, dx, vx };
      return committed ? 'commit' : 'cancel';
    },

    goToTarget(direction, outgoingSpread, incomingSpread, initialDx = 0): void {
      const target = direction === 'forward' ? -W : W;
      mode = {
        kind: 'settling',
        direction,
        outgoingSpread,
        incomingSpread,
        target,
        dx: initialDx,
        vx: 0,
      };
    },

    interrupt(timestamp): { dx: number; vx: number } | null {
      if (mode.kind === 'settling') {
        const { direction, outgoingSpread, incomingSpread, dx, vx } = mode;
        mode = {
          kind: 'tracking',
          direction,
          outgoingSpread,
          incomingSpread,
          dx,
          vx,
          lastSampleAt: timestamp,
        };
        return { dx, vx };
      }
      if (mode.kind === 'boundary-elastic') {
        const { slotSpread, dx, vx } = mode;
        mode = {
          kind: 'tracking',
          direction: 'forward',
          outgoingSpread: slotSpread,
          incomingSpread: null,
          dx,
          vx,
          lastSampleAt: timestamp,
        };
        return { dx, vx };
      }
      return null;
    },

    step(dt): DrawInstruction {
      switch (mode.kind) {
        case 'idle':
          return { kind: 'single', slot: 'curr' };

        case 'tracking':
          return { kind: 'turning', ...getSlotPositions(mode), dx: mode.dx };

        case 'settling': {
          const result = stepSettling(mode, opts, dt);
          mode = result.nextMode;
          if (result.settled) emitSettled(result.settled);
          return result.instruction;
        }

        case 'boundary-elastic': {
          const result = stepBoundaryElastic(mode, opts, dt);
          mode = result.nextMode;
          if (result.settled) emitSettled(result.settled);
          return result.instruction;
        }
      }
    },

    forceSettle(): number {
      const result = forceSettleMode(mode);
      mode = { kind: 'idle' };
      if (result.settled) emitSettled(result.settled);
      return result.residualDx;
    },

    configure(update): void {
      opts = { ...opts, ...update };
    },

    reset(): void {
      mode = { kind: 'idle' };
    },

    onSettled(cb): () => void {
      settledListeners.add(cb);
      return () => settledListeners.delete(cb);
    },
  };

  return driver;
}
