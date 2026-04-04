import { useEffect, useRef } from 'react';
import type { ReaderController, ReaderControllerEvents } from '@rito/kit';

/**
 * Subscribe to a typed controller event.
 * The handler is ref-stable to avoid resubscriptions on every render.
 */
export function useControllerEvent<K extends keyof ReaderControllerEvents>(
  controller: ReaderController | null,
  event: K,
  handler: (data: ReaderControllerEvents[K]) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!controller) return;
    return controller.on(event, (data) => {
      handlerRef.current(data);
    });
  }, [controller, event]);
}
