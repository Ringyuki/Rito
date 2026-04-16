import { useCallback, useState } from 'react';
import type { ReaderController } from '@rito/kit';
import type { TextRange } from '@rito/core/selection';
import { useControllerEvent } from '../utils/use-controller-event';

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SelectionState {
  readonly range: TextRange | null;
  readonly text: string;
  /** Selection rects in spread-content space (legacy — prefer viewportRects). */
  readonly rects: readonly Rect[];
  /** Selection rects in viewport-logical space (includes margins). */
  readonly viewportRects: readonly Rect[];
  /** Rect of the active endpoint (focus) in viewport-logical space. Follows the user's pointer. */
  readonly focusRect: Rect | null;
  readonly hasSelection: boolean;
}

export function useSelection(controller: ReaderController | null): SelectionState & {
  clear: () => void;
} {
  const [state, setState] = useState<SelectionState>({
    range: null,
    text: '',
    rects: [],
    viewportRects: [],
    focusRect: null,
    hasSelection: false,
  });

  useControllerEvent(
    controller,
    'selectionChange',
    ({ range, text, rects, viewportRects, focusRect }) => {
      setState({ range, text, rects, viewportRects, focusRect, hasSelection: range !== null });
    },
  );

  const clear = useCallback(() => {
    controller?.clearSelection();
  }, [controller]);

  return { ...state, clear };
}
