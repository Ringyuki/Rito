import type { SlotPosition } from '../painter/types';

/**
 * One frame of a page turn as an effect sees it: how far the turn has
 * travelled (`dx`, CSS px, negative while turning forward), the page width,
 * and which neighbour is coming in (`null` while pulling against the first
 * or last spread).
 */
export interface TransitionFrame {
  readonly dx: number;
  readonly width: number;
  readonly incoming: 'next' | 'prev' | null;
}

/**
 * One page drawn for a frame, bottom to top: the slot, its x offset, its
 * opacity, and an optional shadow cast from one vertical edge (the edge of
 * a sheet lying over the page beneath it).
 */
export interface TransitionLayer {
  readonly slot: SlotPosition;
  readonly x: number;
  readonly opacity?: number;
  readonly shadow?: 'left' | 'right';
}

/**
 * How a page turn looks. The physics — the spring, the drag, the commit
 * decision and the rubber band at the ends — is the same for every effect;
 * an effect only says which pages to draw where at a given displacement.
 */
export interface TransitionEffect {
  /** The pages to draw, bottom to top. */
  layers(frame: TransitionFrame): readonly TransitionLayer[];
  /** A turn lands at once instead of animating (drags still decide commit). */
  readonly instant?: boolean;
}

/** The whole spread moves with the turn; the neighbour follows edge to edge. */
const slide: TransitionEffect = {
  layers({ dx, width, incoming }) {
    const layers: TransitionLayer[] = [];
    // A spring overshooting back past the origin shows the far neighbour
    // instead of a gap.
    if (incoming === 'next' && dx > 0) layers.push({ slot: 'prev', x: dx - width });
    if (incoming === 'prev' && dx < 0) layers.push({ slot: 'next', x: dx + width });
    layers.push({ slot: 'curr', x: dx });
    if (incoming === 'next') layers.push({ slot: 'next', x: dx + width });
    if (incoming === 'prev') layers.push({ slot: 'prev', x: dx - width });
    return layers;
  },
};

/**
 * Pages stack with later pages on top: turning forward slides the next page
 * over the current one, turning back slides the current page off the one
 * before it. The moving sheet casts a shadow on the page beneath.
 */
const cover: TransitionEffect = {
  layers({ dx, width, incoming }) {
    if (incoming === 'next') {
      return [
        { slot: 'curr', x: 0 },
        { slot: 'next', x: Math.max(0, width + dx), shadow: 'left' },
      ];
    }
    if (incoming === 'prev') {
      return [
        { slot: 'prev', x: 0 },
        { slot: 'curr', x: Math.max(0, dx), shadow: 'left' },
      ];
    }
    return [{ slot: 'curr', x: dx }];
  },
};

/** The pages cross-fade in place; nothing moves except at the ends. */
const fade: TransitionEffect = {
  layers({ dx, width, incoming }) {
    if (incoming === null) return [{ slot: 'curr', x: dx }];
    const progress = width > 0 ? Math.min(1, Math.abs(dx) / width) : 1;
    return [
      { slot: 'curr', x: 0 },
      { slot: incoming, x: 0, opacity: progress },
    ];
  },
};

/** No animation: a turn lands at once and the page never moves under a drag. */
const none: TransitionEffect = {
  instant: true,
  layers: () => [{ slot: 'curr', x: 0 }],
};

/** The built-in page-turn effects. */
export const transitionEffects = { slide, cover, fade, none } as const;

export type TransitionEffectName = keyof typeof transitionEffects;

/**
 * Spring tunings for the turn (stiffness in 1/s², damping in 1/s): `snappy`
 * lands fast with no overshoot, `gentle` drifts in, `default` sits between
 * with a hint of settle.
 */
export const springPresets = {
  default: { stiffness: 180, damping: 22 },
  snappy: { stiffness: 320, damping: 36 },
  gentle: { stiffness: 110, damping: 21 },
} as const;

export function resolveTransitionEffect(
  effect: TransitionEffectName | TransitionEffect,
): TransitionEffect {
  return typeof effect === 'string' ? transitionEffects[effect] : effect;
}
