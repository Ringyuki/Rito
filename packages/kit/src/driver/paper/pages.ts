import { transitionEffects, type TransitionFrame, type TransitionScene } from '../effects';

/** The turn without a GPU: the built-in cover's pages. */
export function paintPlain(scene: TransitionScene, frame: TransitionFrame): void {
  for (const layer of transitionEffects.cover.layers(frame)) {
    scene.drawPage(layer.slot, Math.round(layer.x), layer.opacity);
  }
}

/** A `#rrggbb` colour as red, green and blue from 0 to 1; white for anything else. */
export function colourOf(hex: string | undefined): [number, number, number] {
  const digits = /^#([0-9a-f]{6})$/i.exec(hex ?? '')?.[1];
  if (!digits) return [1, 1, 1];
  const channel = (at: number): number => Number.parseInt(digits.slice(at, at + 2), 16) / 255;
  return [channel(0), channel(2), channel(4)];
}
