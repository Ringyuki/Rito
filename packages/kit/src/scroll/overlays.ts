import { paintOverlayInto } from '../painter/overlay-painter';
import { uploadCanvas } from '../painter/gl/targets';
import type { OverlayLayer } from '../painter/types';

interface Entry {
  readonly canvas: OffscreenCanvas;
  readonly texture: WebGLTexture;
  /** The highlights' version it was painted for. */
  version: number;
  /** Whether it shows anything. */
  shown: boolean;
}

/**
 * What a scrolled view draws over each window: its highlights, painted once
 * into a texture the window's device size and moved with the window, so
 * the strip scrolls without painting them again.
 */
export interface WindowOverlays {
  /**
   * The overlay of window `spreadIndex`, `width` × `height` device pixels,
   * for highlights at `version`, painted from `layers` (CSS pixels of the
   * window's display list) when they changed; undefined when it shows none.
   */
  texture(
    spreadIndex: number,
    width: number,
    height: number,
    ratio: number,
    version: number,
    layers: () => readonly OverlayLayer[],
  ): WebGLTexture | undefined;
  /** Drops the overlays of every window but these. */
  keep(spreadIndexes: ReadonlySet<number>): void;
  dispose(): void;
}

export function createWindowOverlays(gl: WebGL2RenderingContext): WindowOverlays {
  const entries = new Map<number, Entry>();
  const drop = (entry: Entry): void => {
    gl.deleteTexture(entry.texture);
  };
  return {
    texture(spreadIndex, width, height, ratio, version, layers) {
      let entry = entries.get(spreadIndex);
      if (entry?.canvas.width !== width || entry.canvas.height !== height) {
        if (entry) drop(entry);
        entry = {
          canvas: new OffscreenCanvas(width, height),
          texture: gl.createTexture(),
          version: -1,
          shown: false,
        };
        entries.set(spreadIndex, entry);
      }
      if (entry.version !== version) {
        entry.version = version;
        const drawn = layers();
        entry.shown = drawn.some((layer) => layer.rects.length > 0);
        if (entry.shown) {
          const context = entry.canvas.getContext('2d');
          if (!context) throw new Error('A 2D canvas for scrolled highlights is unavailable');
          paintOverlayInto(context, drawn, ratio);
          uploadCanvas(gl, entry.texture, entry.canvas);
        }
      }
      return entry.shown ? entry.texture : undefined;
    },
    keep(spreadIndexes) {
      for (const [spreadIndex, entry] of entries) {
        if (spreadIndexes.has(spreadIndex)) continue;
        drop(entry);
        entries.delete(spreadIndex);
      }
    },
    dispose() {
      for (const entry of entries.values()) drop(entry);
      entries.clear();
    },
  };
}
