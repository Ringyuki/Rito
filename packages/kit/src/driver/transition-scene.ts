import type { SlotPosition } from '../painter/types';
import type {
  TransitionEffect,
  TransitionFrame,
  TransitionLayer,
  TransitionPage,
  TransitionScene,
} from './effects';

/**
 * A scene over a cleared surface whose pages come from `pageOf`, which
 * answers null for a page that is not painted yet.
 */
export function createTransitionScene(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  pageOf: (slot: SlotPosition) => TransitionPage | null,
): TransitionScene {
  return {
    context,
    width,
    height,
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
  if (layer.shadow) {
    const edgeX = layer.shadow === 'left' ? x : x + scene.width;
    drawEdgeShadow(scene.context, edgeX, layer.shadow, scene.height);
  }
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

/** The soft shadow a sheet casts on the page beneath it, from one edge. */
function drawEdgeShadow(
  context: CanvasRenderingContext2D,
  edgeX: number,
  side: 'left' | 'right',
  height: number,
): void {
  const reach = 24;
  const to = side === 'left' ? edgeX - reach : edgeX + reach;
  const gradient = context.createLinearGradient(edgeX, 0, to, 0);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.18)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  context.fillStyle = gradient;
  context.fillRect(Math.min(edgeX, to), 0, reach, height);
}
