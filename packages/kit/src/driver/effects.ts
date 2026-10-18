import type { SlotPosition } from '../painter/types';
import type { TransitionPhysics } from './physics';

/** A point of the display canvas, from its top-left corner. */
export interface TransitionPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The finger that moved a turn: where it took hold of the page and where it
 * is, or, once it lifted, where it let go; and where it was when it had
 * carried the turn farthest the way the turn goes (`farthest`), which is
 * where it is when that is left out. A finger short of its farthest has
 * come back.
 */
export interface TransitionTouch {
  readonly origin: TransitionPoint;
  readonly position: TransitionPoint;
  readonly farthest?: TransitionPoint;
}

/**
 * What is moving a turn: a finger holds it (`held`), it is on its way to
 * the neighbour (`landing`), or on its way back to the spread it left
 * (`returning`).
 */
export type TransitionPhase = 'held' | 'landing' | 'returning';

/**
 * One frame of a page turn as an effect sees it: how far the turn has
 * travelled (`dx`, negative while turning forward), the page width, which
 * neighbour is coming in (`null` while pulling against the first or last
 * spread), what is moving it (`phase`), how fast `dx` is changing
 * (`velocity`, per second; 0 while a finger holds the turn) and the finger
 * that moved it (`touch`; `null` for a turn no finger has held: a key, a
 * tap, a call). Lengths and points are in the units the frame is drawn in,
 * the display canvas's own pixels.
 */
export interface TransitionFrame {
  readonly dx: number;
  readonly width: number;
  readonly incoming: 'next' | 'prev' | null;
  readonly phase: TransitionPhase;
  readonly velocity: number;
  readonly touch: TransitionTouch | null;
}

/**
 * One page drawn for a frame, bottom to top: the slot, its x offset, its
 * opacity, and an optional shadow cast from one vertical edge (the edge of
 * a sheet lying over the page beneath it). The shadow reaches 24 CSS px
 * and fades as its sheet leaves the frame.
 */
export interface TransitionLayer {
  readonly slot: SlotPosition;
  readonly x: number;
  readonly opacity?: number;
  readonly shadow?: 'left' | 'right';
}

/**
 * A page as a painted effect sees it: one texture of the display's WebGL2
 * context holding the page with its overlay (highlights, selection) over
 * it, `width` by `height` texels, `pixelRatio` of them to a unit of the
 * scene. Its rows run as a framebuffer's do: the last row is the top of
 * the page. Premultiplied.
 */
export interface TransitionPage {
  /** Which spread of the book it is: what tells a page from every other across turns. */
  readonly spread: number;
  readonly texture: WebGLTexture;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  /**
   * Changes whenever the page or its overlay is painted again: what an
   * effect keeps of a page (a copy of the texture) is good for one version.
   */
  readonly version: number;
}

/**
 * Where a painted effect draws one frame: the display's WebGL2 context,
 * its own framebuffer bound and cleared, `width` by `height` device
 * pixels. The effect draws the frame into that framebuffer.
 */
export interface TransitionScene {
  readonly gl: WebGL2RenderingContext;
  readonly width: number;
  readonly height: number;
  /** The length of a CSS pixel in those units: what sizes a shadow or a curl. */
  readonly cssPixel: number;
  /**
   * Where the pages are bound, as an x in those units: the left edge when a
   * spread is one page, the middle when it is two.
   */
  readonly spine: number;
  /**
   * The page in a slot, or null while it is not painted yet. Asking for it
   * may paint it, which changes the context's program, vertex array,
   * textures and blending; the display's framebuffer is bound again after.
   */
  page(slot: SlotPosition): TransitionPage | null;
  /**
   * Draws a page whole at `x`, with its overlay, over what is drawn; a page
   * not painted yet is skipped. It changes the same state `page` does.
   */
  drawPage(slot: SlotPosition, x: number, opacity?: number): void;
}

/**
 * How a page turn looks: whole pages laid over each other (`layers`), or
 * the frame painted directly (`paint`) for looks such as a curl that bend
 * or cut the pages. How a turn moves — the drag, the decision to turn, the
 * way to rest, the pull at the ends of the book — is its physics: the
 * built-in spring unless the options or the effect bring their own.
 */
export type TransitionEffect = LayeredTransitionEffect | PaintedTransitionEffect;

export interface LayeredTransitionEffect {
  /** The pages to draw, bottom to top. */
  layers(frame: TransitionFrame): readonly TransitionLayer[];
  /** See `PaintedTransitionEffect.prepare`. */
  prepare?(gl: WebGL2RenderingContext): void;
  /** A turn lands at once instead of animating (drags still decide commit). */
  readonly instant?: boolean;
  /** The physics the effect is made for; `physics` in the options outranks them. */
  readonly physics?: TransitionPhysics;
}

export interface PaintedTransitionEffect {
  paint(scene: TransitionScene, frame: TransitionFrame): void;
  /**
   * Called when the effect is set, before any turn, with the display's
   * WebGL2 context: the place for work that would otherwise hold up the
   * first frame of the first turn, such as compiling programs. It may be
   * called more than once, and again with a new context after the display
   * lost its context.
   */
  prepare?(gl: WebGL2RenderingContext): void;
  /** A turn lands at once instead of animating (drags still decide commit). */
  readonly instant?: boolean;
  /** The physics the effect is made for; `physics` in the options outranks them. */
  readonly physics?: TransitionPhysics;
}

/** The whole spread moves with the turn; the neighbour follows edge to edge. */
const slide: LayeredTransitionEffect = {
  layers({ dx, width, incoming }) {
    const layers: TransitionLayer[] = [];
    // A custom spring bouncing back past the origin shows the far neighbour
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
const cover: LayeredTransitionEffect = {
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
const fade: LayeredTransitionEffect = {
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
const none: LayeredTransitionEffect = {
  instant: true,
  layers: () => [{ slot: 'curr', x: 0 }],
};

/** The built-in page-turn effects. */
export const transitionEffects = { slide, cover, fade, none } as const;

export type TransitionEffectName = keyof typeof transitionEffects;

/**
 * Spring tunings for the turn (stiffness in 1/s², damping in 1/s): `snappy`
 * lands fast, `gentle` drifts in, `default` sits between. All are damped at
 * or just above critical, so a turn never bounces: past the neighbour, or
 * back past the page it started on, there may be no page to show. A custom
 * spring damped below critical bounces, and shows that gap.
 */
export const springPresets = {
  default: { stiffness: 180, damping: 27 },
  snappy: { stiffness: 320, damping: 36 },
  gentle: { stiffness: 110, damping: 21 },
} as const;

export function resolveTransitionEffect(
  effect: TransitionEffectName | TransitionEffect,
): TransitionEffect {
  return typeof effect === 'string' ? transitionEffects[effect] : effect;
}
