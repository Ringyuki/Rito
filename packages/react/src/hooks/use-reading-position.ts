import { useCallback, useState } from 'react';
import type { ReaderController } from '@ritojs/kit';
import type { ReadingPosition } from '@ritojs/core/position';
import { useControllerEvent } from '../utils/use-controller-event';

export interface ReadingPositionState {
  readonly position: ReadingPosition | null;
}

export function useReadingPosition(controller: ReaderController | null): ReadingPositionState & {
  save: () => Promise<void>;
  restore: () => Promise<number | undefined>;
} {
  const [position, setPosition] = useState<ReadingPosition | null>(null);

  useControllerEvent(controller, 'positionChange', ({ position: pos }) => {
    setPosition(pos);
  });

  const save = useCallback(async () => {
    await controller?.savePosition();
  }, [controller]);
  const restore = useCallback(async () => controller?.restorePosition(), [controller]);

  return { position, save, restore };
}
