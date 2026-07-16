import type { Dispatch, SetStateAction } from 'react';
import type { ReaderController } from '@ritojs/kit';
import type { InternalState } from './use-rito-reader-model';

export function subscribeReaderControllerEvents(
  controller: ReaderController,
  setState: Dispatch<SetStateAction<InternalState>>,
): () => void {
  const unsubscribers: (() => void)[] = [];
  try {
    unsubscribers.push(
      controller.on('spreadChange', ({ spreadIndex }) => {
        setState((state) => ({ ...state, currentSpread: spreadIndex }));
      }),
    );
    unsubscribers.push(
      controller.on('layoutChange', ({ spreads, totalSpreads }) => {
        const hasLayout = totalSpreads > 0;
        setState((state) => ({
          ...state,
          isLoaded: hasLayout,
          isLoading: !hasLayout,
          spreads,
          totalSpreads,
        }));
      }),
    );
    unsubscribers.push(
      controller.on('error', ({ message }) => {
        setState((state) => ({ ...state, error: message }));
      }),
    );
  } catch (error) {
    disposeSubscriptions(unsubscribers);
    throw error;
  }
  return () => {
    disposeSubscriptions(unsubscribers);
  };
}

function disposeSubscriptions(unsubscribers: readonly (() => void)[]): void {
  for (const unsubscribe of unsubscribers) {
    try {
      unsubscribe();
    } catch {
      // One broken subscription must not retain the rest.
    }
  }
}
