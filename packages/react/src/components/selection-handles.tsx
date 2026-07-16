import { useLayoutEffect, useState, type RefObject } from 'react';
import type { ReaderController, SelectionHandleState } from '@ritojs/kit';
import { useSelection } from '../hooks/use-selection';
import { SelectionHandle, type CanvasPlacement } from './selection-handle';
import { useSelectionHandleDrag, type ActiveDragVisual } from './selection-handle-drag';

interface SelectionHandlesProps {
  readonly controller: ReaderController | null;
  readonly rootRef: RefObject<HTMLDivElement | null>;
  readonly touchInput: boolean;
}

export function SelectionHandles({
  controller,
  rootRef,
  touchInput,
}: SelectionHandlesProps): React.JSX.Element | null {
  const selection = useSelection(controller);
  const handles = selection.handles;
  const visible = touchInput && selection.hasSelection && handles !== null;
  const placement = useCanvasPlacement(rootRef, controller, visible);
  const drag = useSelectionHandleDrag(controller, visible);
  const keepCapturedHandleMounted = drag.activeVisual !== null && handles !== null;
  if ((!visible && !keepCapturedHandleMounted) || !placement || !controller) return null;
  return (
    <SelectionHandlesLayer
      handles={handles}
      placement={placement}
      controller={controller}
      drag={drag}
    />
  );
}

interface SelectionHandlesLayerProps {
  readonly handles: SelectionHandleState;
  readonly placement: CanvasPlacement;
  readonly controller: ReaderController;
  readonly drag: ReturnType<typeof useSelectionHandleDrag>;
}

function SelectionHandlesLayer({
  handles,
  placement,
  controller,
  drag,
}: SelectionHandlesLayerProps): React.JSX.Element {
  const projectedMovingCaret = handles.focusEdge ? handles[handles.focusEdge] : null;
  useLayoutEffect(() => {
    drag.rememberVisibleCaret(projectedMovingCaret);
  }, [drag, projectedMovingCaret]);
  const displayed = resolveDisplayedCarets(handles, drag.activeVisual);
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {(['start', 'end'] as const).map((edge) => {
        const caret = displayed[edge];
        if (!caret) return null;
        return (
          <SelectionHandle
            key={edge}
            edge={edge}
            caret={caret}
            offset={placement}
            scale={controller.renderScale}
            active={drag.activeVisual?.edge === edge}
            onPointerDown={(event) => {
              drag.begin(edge, caret, event);
            }}
            onPointerMove={drag.move}
            onPointerUp={drag.finish}
            onPointerCancel={drag.cancel}
            onLostPointerCapture={drag.loseCapture}
          />
        );
      })}
    </div>
  );
}

function useCanvasPlacement(
  rootRef: RefObject<HTMLDivElement | null>,
  controller: ReaderController | null,
  enabled: boolean,
): CanvasPlacement | null {
  const [placement, setPlacement] = useState<CanvasPlacement | null>(null);
  useLayoutEffect(() => {
    if (!enabled) return;
    const root = rootRef.current;
    if (!root) return;
    const canvas = findControllerCanvas(root);
    if (!canvas) return;
    const update = () => {
      const rootRect = root.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const x = canvasRect.left - rootRect.left - root.clientLeft + root.scrollLeft;
      const y = canvasRect.top - rootRect.top - root.clientTop + root.scrollTop;
      setPlacement((current) => (samePlacement(current, x, y) ? current : { x, y }));
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
  }, [controller, controller?.renderScale, enabled, rootRef]);
  return placement;
}

function findControllerCanvas(root: HTMLDivElement): HTMLCanvasElement | null {
  for (const child of root.children) {
    if (
      child instanceof HTMLCanvasElement &&
      child.getAttribute('data-rito-reader-surface') === 'true'
    ) {
      return child;
    }
  }
  return null;
}

function resolveDisplayedCarets(
  handles: SelectionHandleState,
  active: ActiveDragVisual | null,
): Pick<SelectionHandleState, 'start' | 'end'> {
  if (!active || !handles.focusEdge) return handles;
  const moving = handles[handles.focusEdge] ?? active.fallbackCaret;
  const fixed = handles[handles.focusEdge === 'start' ? 'end' : 'start'];
  return active.edge === 'start' ? { start: moving, end: fixed } : { start: fixed, end: moving };
}

function samePlacement(current: CanvasPlacement | null, x: number, y: number): boolean {
  return current?.x === x && current.y === y;
}
