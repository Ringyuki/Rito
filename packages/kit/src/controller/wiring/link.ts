import type { Reader } from '@ritojs/core';
import type { CoordinatorState } from '../core/coordinator-state';
import { findNativeTargetAtPos } from './native-targets';

/**
 * Pointer cursor over actionable page targets (links, footnotes, images) for
 * desktop pointer events. Click handling is done by the unified
 * `dispatchClick()` in click-dispatch.ts.
 */
export function bindLinkCursor(
  canvas: HTMLCanvasElement,
  coordState: CoordinatorState,
  toSpreadContent: (e: PointerEvent) => { x: number; y: number },
  reader: Reader,
): () => void {
  const onMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return;
    const actionable =
      reader.interactions?.enabled === true &&
      findNativeTargetAtPos(toSpreadContent(e), coordState) !== undefined;
    canvas.style.cursor = actionable ? 'pointer' : '';
  };

  canvas.addEventListener('pointermove', onMove);
  return () => {
    canvas.removeEventListener('pointermove', onMove);
    canvas.style.cursor = '';
  };
}
