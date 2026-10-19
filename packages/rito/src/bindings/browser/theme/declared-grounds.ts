import type { CanvasTextColorOverride } from '../canvas-text/types';
import { isBookOwnedPageGround, resolveTextColor } from './text-color';

interface GroundRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What a fill declares to the theme override. */
export interface GroundedFill {
  readonly ground: 'none' | 'page' | 'block';
  readonly groundRect?: GroundRect | undefined;
}

/** The declared grounds a replay accumulates for the theme override:
 * opaque block backgrounds so far, and the page ground R1 kept for the
 * book. Reset by every page ground. */
export interface DeclaredGrounds {
  readonly blockGrounds: { readonly rect: GroundRect; readonly color: string }[];
  bookOwnedPageGround: string | undefined;
}

export function createDeclaredGrounds(): DeclaredGrounds {
  return { blockGrounds: [], bookOwnedPageGround: undefined };
}

/** The colour a fill paints, after its declared ground is taken in. A
 * fill declaring the page ground resets the declared grounds and takes
 * the theme's R1 decision: a designed ground (opaque, darker than the
 * white-paper limit) stays the book's and marks the page book-owned; a
 * near-white ground is the typesetter's paper default and the theme
 * paints its own. A fill declaring a block ground records the unsnapped
 * box it covers for the ink typeset over it (the engine only declares
 * opaque ones). */
export function declareFillGround(
  grounds: DeclaredGrounds,
  fill: GroundedFill,
  color: string,
  override: CanvasTextColorOverride | undefined,
): string {
  if (fill.ground === 'page') {
    grounds.blockGrounds.length = 0;
    grounds.bookOwnedPageGround = undefined;
    if (override) {
      if (isBookOwnedPageGround(color)) grounds.bookOwnedPageGround = color;
      else return override.backgroundColor;
    }
  } else if (fill.ground === 'block' && fill.groundRect !== undefined) {
    grounds.blockGrounds.push({ rect: fill.groundRect, color });
  }
  return color;
}

/** The ground a run's ink was typeset against, when the book expressed
 * one (R2): the nearest opaque fill containing the run's rect — the run's
 * own inline band lowers to such a fill just before the run — else the
 * page ground R1 kept for the book. Undefined means the theme supplies
 * the ground. Both rects are device rects. */
export function declaredGroundFor(rect: GroundRect, grounds: DeclaredGrounds): string | undefined {
  for (let index = grounds.blockGrounds.length - 1; index >= 0; index -= 1) {
    const ground = grounds.blockGrounds[index];
    if (
      ground !== undefined &&
      rect.x >= ground.rect.x &&
      rect.y >= ground.rect.y &&
      rect.x + rect.width <= ground.rect.x + ground.rect.width &&
      rect.y + rect.height <= ground.rect.y + ground.rect.height
    ) {
      return ground.color;
    }
  }
  return grounds.bookOwnedPageGround;
}

/** The ink a run paints in. R2: ink is only re-resolved when its ground
 * is theme-supplied. A declared ground (inline band, block fill,
 * book-owned page) means the foreground/background pair was the
 * typesetter's choice — any one-sided substitution would break it. */
export function themedInk(
  color: string,
  override: CanvasTextColorOverride | undefined,
  declaredGround: string | undefined,
): string {
  if (!override || declaredGround !== undefined) return color;
  return resolveTextColor(color, override.backgroundColor, override.foregroundColor);
}
