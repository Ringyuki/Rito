import type { PageBufferPool } from '../painter/buffer-pool';
import type { DisplaySurface } from '../painter/display-surface';
import type { SlotPosition } from '../painter/types';
import type {
  TransitionEffect,
  TransitionFrame,
  TransitionLayer,
  TransitionPage,
  TransitionPoint,
  TransitionScene,
  TransitionTouch,
} from './effects';

/** How far a sheet's shadow reaches over the page beneath it, CSS px. */
const SHADOW_REACH = 24;
/** How dark the shadow is at the sheet's edge. */
const SHADOW_ALPHA = 0.18;

/** A finger's points, from CSS px into the units the frame is drawn in. */
export function scaledTouch(touch: TransitionTouch, scale: number): TransitionTouch {
  const scaled = (point: TransitionPoint): TransitionPoint => ({
    x: point.x * scale,
    y: point.y * scale,
  });
  return {
    origin: scaled(touch.origin),
    position: scaled(touch.position),
    ...(touch.farthest ? { farthest: scaled(touch.farthest) } : {}),
  };
}

/** What a scene draws its pages from. */
export interface SceneSource {
  readonly surface: DisplaySurface;
  readonly pool: PageBufferPool;
  /** Whether a slot's page is painted, painting it if it can be. */
  readonly ready: (slot: SlotPosition) => boolean;
}

/**
 * A scene over the cleared display. `cssPixel` is the length of a CSS
 * pixel in the surface's units and `spine` where the pages are bound.
 */
export function createTransitionScene(
  source: SceneSource,
  width: number,
  height: number,
  cssPixel = 1,
  spine = 0,
): TransitionScene {
  const { surface, pool } = source;
  const pages = new Map<SlotPosition, TransitionPage | null>();
  return {
    gl: surface.gl,
    width,
    height,
    cssPixel,
    spine,
    page(slot): TransitionPage | null {
      if (!pages.has(slot)) pages.set(slot, transitionPage(source, slot, width));
      return pages.get(slot) ?? null;
    },
    drawPage(slot, x, opacity = 1): void {
      if (!source.ready(slot)) return;
      surface.compositor.bind(null, surface.width, surface.height);
      pool.drawSlot(slot, { x, y: 0, width, height }, opacity);
    },
  };
}

function transitionPage(
  source: SceneSource,
  slot: SlotPosition,
  width: number,
): TransitionPage | null {
  if (!source.ready(slot)) return null;
  const { surface, pool } = source;
  const texture = pool.pageTexture(slot);
  // Making the texture may have bound a framebuffer of its own.
  surface.compositor.bind(null, surface.width, surface.height);
  const painted = pool[slot];
  return {
    spread: painted.spreadIndex ?? 0,
    texture: texture.texture,
    width: texture.width,
    height: texture.height,
    pixelRatio: width > 0 ? texture.width / width : 1,
    version: painted.paints,
  };
}

/** Paint one frame of a turn with either kind of effect. */
export function paintTransition(
  scene: TransitionScene,
  effect: TransitionEffect,
  frame: TransitionFrame,
  surface: DisplaySurface,
): void {
  if ('paint' in effect) {
    effect.paint(scene, frame);
    return;
  }
  for (const layer of effect.layers(frame)) drawLayer(scene, surface, layer);
}

function drawLayer(scene: TransitionScene, surface: DisplaySurface, layer: TransitionLayer): void {
  const opacity = layer.opacity ?? 1;
  if (opacity <= 0 || !scene.page(layer.slot)) return;
  const x = Math.round(layer.x);
  if (layer.shadow) drawEdgeShadow(scene, surface, x, layer.shadow);
  scene.drawPage(layer.slot, x, opacity);
}

/**
 * The soft shadow the sheet at `x` casts on the page beneath it, from one
 * edge. A sheet leaving the frame takes its shadow with it: with less of
 * the sheet in the frame than the shadow reaches, the shadow is as strong
 * as that share, and gone when the sheet is. At full strength there it
 * stood beside a sheet no longer shown and went out in one frame when
 * the turn ended.
 */
function drawEdgeShadow(
  scene: TransitionScene,
  surface: DisplaySurface,
  x: number,
  side: 'left' | 'right',
): void {
  const reach = SHADOW_REACH * scene.cssPixel;
  const inFrame = Math.min(x + scene.width, scene.width) - Math.max(x, 0);
  const strength = Math.min(1, inFrame / reach);
  if (strength <= 0) return;
  const edgeX = side === 'left' ? x : x + scene.width;
  // The shadow's ink is a CSS colour, black at that alpha, and a colour
  // keeps its alpha as a byte: the ramp runs to that byte.
  const alpha = Math.round(SHADOW_ALPHA * strength * 255) / 255;
  const rect = {
    x: side === 'left' ? edgeX - reach : edgeX,
    y: 0,
    width: reach,
    height: scene.height,
  };
  surface.compositor.bind(null, surface.width, surface.height);
  // The ramp is darkest at the sheet's edge.
  if (side === 'left') surface.compositor.drawRamp(rect, 0, alpha);
  else surface.compositor.drawRamp(rect, alpha, 0);
}
