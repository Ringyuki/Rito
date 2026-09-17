import type { ContentHitKind, ReaderClientPoint } from '../types';
import { clientToSpreadContent } from '../core/wiring-deps';
import { hitTestContentAt } from '../wiring/click-dispatch';
import type { WiringDeps } from '../core/wiring-deps';
import type { ContentHitSlice } from './types';

export function buildContentHit(canvas: HTMLCanvasElement, deps: WiringDeps): ContentHitSlice {
  return {
    hitTestContent(point: ReaderClientPoint): ContentHitKind | null {
      // Measured per call rather than cached: the host asks during a
      // pointer gesture, when the canvas may have just been resized or
      // scrolled, and a stale rect would answer for the wrong pixel.
      const rect = canvas.getBoundingClientRect();
      const pos = clientToSpreadContent(point.clientX, point.clientY, rect, deps.coordState);
      return hitTestContentAt(pos, deps);
    },
  };
}
