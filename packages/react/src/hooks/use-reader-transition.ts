import { useEffect, useState } from 'react';
import type { ReaderController } from '@ritojs/kit';
import { useControllerEvent } from '../utils/use-controller-event';

export interface ReaderTransitionState {
  /** A page turn is on screen: from `transitionStart` to its `transitionEnd`. */
  readonly isTransitioning: boolean;
  /** Which way the turn on screen goes; null when none is. */
  readonly direction: 'forward' | 'backward' | null;
}

const IDLE: ReaderTransitionState = { isTransitioning: false, direction: null };

/**
 * Whether a page turn is on screen, for hiding chrome or deferring work
 * while the page moves. The controller answers every start with exactly
 * one end (a relayout or jump ends a turn as interrupted), so the state
 * never sticks; it resets when the controller is replaced.
 */
export function useReaderTransition(controller: ReaderController | null): ReaderTransitionState {
  const [state, setState] = useState(IDLE);

  useEffect(() => {
    setState(IDLE);
  }, [controller]);
  useControllerEvent(controller, 'transitionStart', ({ direction }) => {
    setState({ isTransitioning: true, direction });
  });
  useControllerEvent(controller, 'transitionEnd', () => {
    setState(IDLE);
  });

  return state;
}

/**
 * How far the page turn on screen has moved, 0 at rest and 1 on arrival,
 * for chrome that follows the page (a dimming scrim, a progress edge). It
 * re-renders on every painted frame of a turn, so read it in a small
 * component of its own; it is 0 whenever no turn is on screen.
 */
export function useReaderTransitionProgress(controller: ReaderController | null): number {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    setProgress(0);
  }, [controller]);
  useControllerEvent(controller, 'transitionProgress', (event) => {
    setProgress(event.progress);
  });
  useControllerEvent(controller, 'transitionEnd', () => {
    setProgress(0);
  });

  return progress;
}
