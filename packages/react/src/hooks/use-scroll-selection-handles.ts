import { useEffect, useState } from 'react';
import type { ScrollController, SelectionHandleState } from '@ritojs/kit';

/**
 * A scrolled view's selection ends where the view shows them, as they are
 * selected and as the strip moves under them; null while nothing is
 * selected or a gesture is still selecting. `focusEdge` says which end is
 * the focus, where a toolbar for the selection goes.
 */
export function useScrollSelectionHandles(
  controller: ScrollController | null,
): SelectionHandleState | null {
  const [handles, setHandles] = useState<SelectionHandleState | null>(null);
  useEffect(() => {
    setHandles(controller?.selectionHandles() ?? null);
    if (!controller) return;
    const stops = [
      controller.on('selection', (selection) => {
        setHandles(selection.range && !selection.selecting ? selection.handles : null);
      }),
      controller.on('scroll', () => {
        if (controller.selection) setHandles(controller.selectionHandles());
      }),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, [controller]);
  return handles;
}
