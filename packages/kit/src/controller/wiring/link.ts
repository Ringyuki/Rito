import { hitTestLink } from '@ritojs/core/advanced';
import type { LinkRegion } from '@ritojs/core/advanced';
import type { CoordinatorState } from '../core/coordinator-state';

/** Hit-test links at a spread-content position. Shared by desktop pointer and touch tap paths. */
export function findLinkAtPos(
  pos: { x: number; y: number },
  coordState: CoordinatorState,
): LinkRegion | undefined {
  const { mapper, linksByPage } = coordState;
  if (!mapper) return undefined;

  const resolved = mapper.spreadContentToPage(pos.x, pos.y);
  if (!resolved) return undefined;

  const regions = linksByPage.get(resolved.pageIndex);
  if (!regions) return undefined;

  return hitTestLink(regions, resolved.x, resolved.y);
}

/**
 * Link cursor for desktop pointer events (hover only).
 * Click handling is done by the unified `dispatchClick()` in click-dispatch.ts.
 */
export function bindLinkCursor(
  canvas: HTMLCanvasElement,
  coordState: CoordinatorState,
  toSpreadContent: (e: PointerEvent) => { x: number; y: number },
): () => void {
  const onMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return;
    canvas.style.cursor = findLinkAtPos(toSpreadContent(e), coordState) ? 'pointer' : '';
  };

  canvas.addEventListener('pointermove', onMove);
  return () => {
    canvas.removeEventListener('pointermove', onMove);
    canvas.style.cursor = '';
  };
}
