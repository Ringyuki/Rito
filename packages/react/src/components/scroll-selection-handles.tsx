import { useLayoutEffect, useState, type RefObject } from 'react';
import type { ScrollController } from '@ritojs/kit';
import { useScrollSelectionHandles } from '../hooks/use-scroll-selection-handles';
import type { CanvasPlacement } from './selection-handle';
import { useSelectionHandleDrag } from './selection-handle-drag';
import { SelectionHandlesLayer } from './selection-handles';

interface ScrollSelectionHandlesProps {
  readonly controller: ScrollController | null;
  /** The element the view's canvas is shown in, which the handles are placed in. */
  readonly rootRef: RefObject<HTMLElement | null>;
  readonly touchInput: boolean;
}

/**
 * A scrolled view's selection handles for touch input: the page reader's
 * handles, placed over the view's canvas and moved with the strip.
 */
export function ScrollSelectionHandles({
  controller,
  rootRef,
  touchInput,
}: ScrollSelectionHandlesProps): React.JSX.Element | null {
  const handles = useScrollSelectionHandles(controller);
  const visible = touchInput && handles !== null;
  const placement = useScrollCanvasPlacement(rootRef, controller, visible);
  const drag = useSelectionHandleDrag(controller, visible);
  // A handle being dragged stays while its drag lasts.
  if (!handles || !placement || (!touchInput && drag.activeVisual === null)) return null;
  return <SelectionHandlesLayer handles={handles} placement={placement} scale={1} drag={drag} />;
}

function useScrollCanvasPlacement(
  rootRef: RefObject<HTMLElement | null>,
  controller: ScrollController | null,
  enabled: boolean,
): CanvasPlacement | null {
  const [placement, setPlacement] = useState<CanvasPlacement | null>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root || !controller) return;
    const canvas = controller.canvas;
    const update = () => {
      const rootRect = root.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const x = canvasRect.left - rootRect.left - root.clientLeft + root.scrollLeft;
      const y = canvasRect.top - rootRect.top - root.clientTop + root.scrollTop;
      setPlacement((current) => (current?.x === x && current.y === y ? current : { x, y }));
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(root);
    observer?.observe(canvas);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [controller, enabled, rootRef]);
  return placement;
}
