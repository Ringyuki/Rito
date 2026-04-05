import { hitTestLink } from 'rito/advanced';
import type { LinkRegion } from 'rito/advanced';
import type { CoordinatorState } from '../core/coordinator-state';

/**
 * Link cursor and click handling — uses per-page link state + mapper for
 * correct right-page hit testing.
 */
export function bindLinkCursor(
  canvas: HTMLCanvasElement,
  coordState: CoordinatorState,
  toSpreadContent: (e: PointerEvent) => { x: number; y: number },
  onClick?: (region: LinkRegion) => void,
): () => void {
  function hitTest(pos: { x: number; y: number }): LinkRegion | undefined {
    const { mapper, linksByPage } = coordState;
    if (!mapper) return undefined;

    const resolved = mapper.spreadContentToPage(pos.x, pos.y);
    if (!resolved) return undefined;

    const regions = linksByPage.get(resolved.pageIndex);
    if (!regions) return undefined;

    return hitTestLink(regions, resolved.x, resolved.y);
  }

  const onMove = (e: PointerEvent): void => {
    canvas.style.cursor = hitTest(toSpreadContent(e)) ? 'pointer' : '';
  };
  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !onClick) return;
    const hit = hitTest(toSpreadContent(e));
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
