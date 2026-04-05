import { useCallback, useState } from 'react';
import type { ReaderController } from '@rito/kit';
import type { TextRange } from 'rito/selection';
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
    hasSelection: false,
  });

  useControllerEvent(controller, 'selectionChange', ({ range, text, rects, viewportRects }) => {
    setState({ range, text, rects, viewportRects, hasSelection: range !== null });
  });

  const clear = useCallback(() => {
    controller?.clearSelection();
  }, [controller]);

  return { ...state, clear };
}
