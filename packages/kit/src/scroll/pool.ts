import type { ReaderGlTarget } from '@ritojs/core';
import {
  createPageTarget,
  deletePageTarget,
  sizePageTarget,
  type GlPageTarget,
} from '../painter/gl/targets';

/** Paints a spread into a target; false while the spread is not loaded yet. */
export type WindowPainter = (spreadIndex: number, target: ReaderGlTarget) => boolean;

interface Entry {
  readonly target: GlPageTarget;
  painted: boolean;
}

/**
 * The pictures of the windows a scrolled view shows and is about to: one
 * texture a window, at the window's device size, painted once and kept
 * until the window is dropped or its content changes.
 */
export interface WindowPool {
  /** The window's picture, `width` × `height` device pixels; undefined while it loads. */
  picture(spreadIndex: number, width: number, height: number): WebGLTexture | undefined;
  /** Forgets what a window was painted with: its next picture is painted again. */
  invalidate(spreadIndex: number): void;
  /** Forgets every picture's paint, keeping the textures. */
  invalidateAll(): void;
  /** Drops the pictures of every window but these. */
  keep(spreadIndexes: ReadonlySet<number>): void;
  dispose(): void;
}

export function createWindowPool(gl: WebGL2RenderingContext, paint: WindowPainter): WindowPool {
  const entries = new Map<number, Entry>();
  return {
    picture(spreadIndex, width, height) {
      let entry = entries.get(spreadIndex);
      if (entry === undefined) {
        entry = { target: createPageTarget(gl, width, height), painted: false };
        entries.set(spreadIndex, entry);
      } else if (entry.target.width !== width || entry.target.height !== height) {
        sizePageTarget(gl, entry.target, width, height);
        entry.painted = false;
      }
      if (!entry.painted) {
        const { framebuffer } = entry.target;
        entry.painted = paint(spreadIndex, { gl, framebuffer, width, height });
      }
      return entry.painted ? entry.target.texture : undefined;
    },
    invalidate(spreadIndex) {
      const entry = entries.get(spreadIndex);
      if (entry) entry.painted = false;
    },
    invalidateAll() {
      for (const entry of entries.values()) entry.painted = false;
    },
    keep(spreadIndexes) {
      for (const [spreadIndex, entry] of entries) {
        if (spreadIndexes.has(spreadIndex)) continue;
        deletePageTarget(gl, entry.target);
        entries.delete(spreadIndex);
      }
    },
    dispose() {
      for (const entry of entries.values()) deletePageTarget(gl, entry.target);
      entries.clear();
    },
  };
}
