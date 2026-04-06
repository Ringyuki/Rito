import { hitTestLink } from 'rito/advanced';
import type { LinkRegion } from 'rito/advanced';
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
 * Link cursor and click handling for desktop pointer events.
 * Touch is excluded — link taps are handled by the unified touch handler's onTap.
 */
export function bindLinkCursor(
  canvas: HTMLCanvasElement,
  coordState: CoordinatorState,
  toSpreadContent: (e: PointerEvent) => { x: number; y: number },
  onClick?: (region: LinkRegion) => void,
): () => void {
  const onMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return;
    canvas.style.cursor = findLinkAtPos(toSpreadContent(e), coordState) ? 'pointer' : '';
  };
  const onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return; // handled by unified touch handler
    if (e.button !== 0 || !onClick) return;
    const hit = findLinkAtPos(toSpreadContent(e), coordState);
    if (hit) onClick(hit);
  };

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  return () => {
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.style.cursor = '';
  };
}
