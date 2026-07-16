import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { SelectionHandleEdge, SelectionHandleState } from '@ritojs/kit';

type HandleCaret = NonNullable<SelectionHandleState['start']>;

export interface CanvasPlacement {
  readonly x: number;
  readonly y: number;
}

interface SelectionHandleProps {
  readonly edge: SelectionHandleEdge;
  readonly caret: HandleCaret;
  readonly offset: CanvasPlacement;
  readonly scale: number;
  readonly active: boolean;
  readonly onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onLostPointerCapture: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

export function SelectionHandle(props: SelectionHandleProps): React.JSX.Element {
  const height = Math.max(1, props.caret.height * props.scale);
  const x = props.offset.x + props.caret.x * props.scale;
  const caretTop = props.offset.y + props.caret.y * props.scale;
  const knobY = props.edge === 'start' ? caretTop : caretTop + height;
  const lineTop = props.edge === 'start' ? 22 : 22 - height;
  return (
    <div
      aria-hidden="true"
      data-rito-selection-handle={props.edge}
      data-testid={`selection-handle-${props.edge}`}
      style={handleStyle(x, knobY, props.active)}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerCancel}
      onLostPointerCapture={props.onLostPointerCapture}
    >
      <span style={lineStyle(lineTop, height)} />
      <span style={KNOB_STYLE} />
    </div>
  );
}

function handleStyle(x: number, knobY: number, active: boolean): CSSProperties {
  return {
    position: 'absolute',
    left: x - 22,
    top: knobY - 22,
    width: 44,
    height: 44,
    zIndex: 20,
    padding: 0,
    border: 0,
    background: 'transparent',
    touchAction: 'none',
    userSelect: 'none',
    pointerEvents: 'auto',
    cursor: active ? 'grabbing' : 'grab',
    overflow: 'visible',
  };
}

function lineStyle(top: number, height: number): CSSProperties {
  return {
    position: 'absolute',
    left: 21,
    top,
    width: 2,
    height,
    borderRadius: 1,
    background: '#2563eb',
    pointerEvents: 'none',
  };
}

const KNOB_STYLE: CSSProperties = {
  position: 'absolute',
  left: 16,
  top: 16,
  width: 12,
  height: 12,
  border: '2px solid white',
  borderRadius: '50%',
  background: '#2563eb',
  boxShadow: '0 1px 3px rgb(0 0 0 / 35%)',
  pointerEvents: 'none',
};
