import { useCallback, useEffect, useState } from 'react';
import type { ReaderLocator } from '@ritojs/core';
import type { ReaderController, SelectionHandleState, TextRange } from '@ritojs/kit';
import { useControllerEvent } from '../utils/use-controller-event';

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SelectionState {
  readonly range: TextRange | null;
  readonly sourceLocator: ReaderLocator | null;
  readonly text: string;
  /** Selection rects in spread-content space (legacy — prefer viewportRects). */
  readonly rects: readonly Rect[];
  /** Selection rects in viewport-logical space (includes margins). */
  readonly viewportRects: readonly Rect[];
  /** Rect of the active endpoint (focus) in viewport-logical space. Follows the user's pointer. */
  readonly focusRect: Rect | null;
  /** Exact native range endpoints in viewport-logical coordinates. */
  readonly handles: SelectionHandleState | null;
  readonly hasSelection: boolean;
}

const EMPTY_SELECTION_STATE: SelectionState = {
  range: null,
  sourceLocator: null,
  text: '',
  rects: [],
  viewportRects: [],
  focusRect: null,
  handles: null,
  hasSelection: false,
};

export function useSelection(controller: ReaderController | null): SelectionState & {
  clear: () => void;
} {
  const [state, setState] = useState(EMPTY_SELECTION_STATE);

  useEffect(() => {
    setState(EMPTY_SELECTION_STATE);
  }, [controller]);

  useControllerEvent(
    controller,
    'selectionChange',
    ({ range, sourceLocator, text, rects, viewportRects, focusRect, handles, hasSelection }) => {
      setState({
        range,
        sourceLocator,
        text,
        rects,
        viewportRects,
        focusRect,
        handles,
        hasSelection,
      });
    },
  );

  const clear = useCallback(() => {
    setState(EMPTY_SELECTION_STATE);
    controller?.clearSelection();
  }, [controller]);

  return { ...state, clear };
}
