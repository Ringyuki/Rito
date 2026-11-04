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
  const { knobX, knobY, line } = handleGeometry(props);
  return (
    <div
      aria-hidden="true"
      data-rito-selection-handle={props.edge}
      data-testid={`selection-handle-${props.edge}`}
      style={handleStyle(knobX, knobY, props.active)}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerCancel}
      onLostPointerCapture={props.onLostPointerCapture}
    >
      <span style={line} />
      <span style={KNOB_STYLE} />
    </div>
  );
}

/**
 * Where a handle's knob sits and the caret line it hangs from: the start's
 * knob at the caret's block-start end, the end's at its block-end end — over
 * and under a caret across a horizontal line, right and left of one across
 * a vertical line (a caret wider than tall).
 */
function handleGeometry({
  edge,
  caret,
  offset,
  scale,
}: Pick<SelectionHandleProps, 'edge' | 'caret' | 'offset' | 'scale'>): {
  knobX: number;
  knobY: number;
  line: CSSProperties;
} {
  const x = offset.x + caret.x * scale;
  const y = offset.y + caret.y * scale;
  if (caret.width > caret.height) {
    const width = Math.max(1, caret.width * scale);
    const start = edge === 'start';
    return {
      knobX: start ? x + width : x,
      knobY: y,
      line: lineStyle({ left: start ? 22 - width : 22, top: 21, width, height: 2 }),
    };
  }
  const height = Math.max(1, caret.height * scale);
  return {
    knobX: x,
    knobY: edge === 'start' ? y : y + height,
    line: lineStyle({ left: 21, top: edge === 'start' ? 22 : 22 - height, width: 2, height }),
  };
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

function lineStyle(box: {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}): CSSProperties {
  return {
    position: 'absolute',
    ...box,
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
