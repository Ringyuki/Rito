import type { SlotPosition } from '../painter/types';
import type {
  TransitionEffect,
  TransitionFrame,
  TransitionLayer,
  TransitionPage,
  TransitionScene,
} from './effects';

/** How far a sheet's shadow reaches over the page beneath it, CSS px. */
const SHADOW_REACH = 24;
/** How dark the shadow is at the sheet's edge. */
const SHADOW_ALPHA = 0.18;

/**
 * A scene over a cleared surface whose pages come from `pageOf`, which
 * answers null for a page that is not painted yet. `cssPixel` is the
 * length of a CSS pixel in the surface's units.
 */
export function createTransitionScene(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  pageOf: (slot: SlotPosition) => TransitionPage | null,
  cssPixel = 1,
): TransitionScene {
  return {
    context,
    width,
    height,
    cssPixel,
    page: pageOf,
    drawPage(slot, x, opacity = 1): void {
      const page = pageOf(slot);
      if (page) drawPageAt(context, page, x, width, height, opacity);
    },
  };
}

/** Paint one frame of a turn with either kind of effect. */
export function paintTransition(
  scene: TransitionScene,
  effect: TransitionEffect,
  frame: TransitionFrame,
): void {
  if ('paint' in effect) {
    effect.paint(scene, frame);
    return;
  }
  for (const layer of effect.layers(frame)) drawLayer(scene, layer);
}

function drawLayer(scene: TransitionScene, layer: TransitionLayer): void {
  const opacity = layer.opacity ?? 1;
  if (opacity <= 0 || !scene.page(layer.slot)) return;
  const x = Math.round(layer.x);
  if (layer.shadow) drawEdgeShadow(scene, x, layer.shadow);
  scene.drawPage(layer.slot, x, opacity);
}

function drawPageAt(
  context: CanvasRenderingContext2D,
  page: TransitionPage,
  x: number,
  width: number,
  height: number,
  opacity: number,
): void {
  const alpha = context.globalAlpha;
  context.globalAlpha = alpha * Math.min(1, opacity);
  try {
    context.drawImage(page.content, x, 0, width, height);
    if (page.overlay) context.drawImage(page.overlay, x, 0, width, height);
  } finally {
    context.globalAlpha = alpha;
  }
}

/**
 * The soft shadow the sheet at `x` casts on the page beneath it, from one
 * edge. A sheet leaving the frame takes its shadow with it: with less of
 * the sheet in the frame than the shadow reaches, the shadow is as strong
 * as that share, and gone when the sheet is. At full strength there it
 * stood beside a sheet no longer shown and went out in one frame when
 * the turn ended.
 */
function drawEdgeShadow(scene: TransitionScene, x: number, side: 'left' | 'right'): void {
  const reach = SHADOW_REACH * scene.cssPixel;
  const inFrame = Math.min(x + scene.width, scene.width) - Math.max(x, 0);
  const strength = Math.min(1, inFrame / reach);
  if (strength <= 0) return;
  const edgeX = side === 'left' ? x : x + scene.width;
  const to = side === 'left' ? edgeX - reach : edgeX + reach;
  const gradient = scene.context.createLinearGradient(edgeX, 0, to, 0);
  gradient.addColorStop(0, `rgba(0, 0, 0, ${String(SHADOW_ALPHA * strength)})`);
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  scene.context.fillStyle = gradient;
  scene.context.fillRect(Math.min(edgeX, to), 0, reach, scene.height);
}
