import type { Reader } from '@ritojs/core';
import { hitTestLink } from '../../interaction/index';
import type { LinkRegion } from '../../interaction/index';
import type { CoordinatorState } from '../core/coordinator-state';
import { findNativeTargetAtPos, usesNativeTargets } from './native-targets';

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
  reader?: Reader,
): () => void {
  const onMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return;
    const pos = toSpreadContent(e);
    const actionable =
      reader && usesNativeTargets(reader)
        ? reader.interactions?.enabled === true &&
          findNativeTargetAtPos(pos, coordState) !== undefined
        : findLinkAtPos(pos, coordState) !== undefined;
    canvas.style.cursor = actionable ? 'pointer' : '';
  };

  canvas.addEventListener('pointermove', onMove);
  return () => {
    canvas.removeEventListener('pointermove', onMove);
    canvas.style.cursor = '';
  };
}
