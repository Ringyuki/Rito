import { useCallback, useState } from 'react';
import type { ReaderController } from '@rito/kit';
import type { ReadingPosition } from 'rito/position';
import { useControllerEvent } from '../utils/use-controller-event';

export interface ReadingPositionState {
  readonly position: ReadingPosition | null;
}

export function useReadingPosition(controller: ReaderController | null): ReadingPositionState & {
  save: () => void;
  restore: () => number | undefined;
} {
  const [position, setPosition] = useState<ReadingPosition | null>(null);

  useControllerEvent(controller, 'positionChange', ({ position: pos }) => {
    setPosition(pos);
  });

  const save = useCallback(() => {
    controller?.savePosition();
  }, [controller]);
  const restore = useCallback(() => controller?.restorePosition(), [controller]);

  return { position, save, restore };
}
