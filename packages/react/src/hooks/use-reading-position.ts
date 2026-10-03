import { useCallback, useEffect, useState } from 'react';
import type { ReaderController, ReadingPosition } from '@ritojs/kit';
import { useControllerEvent } from '../utils/use-controller-event';

export interface ReadingPositionState {
  readonly position: ReadingPosition | null;
}

export function useReadingPosition(controller: ReaderController | null): ReadingPositionState & {
  save: () => Promise<void>;
  restore: () => Promise<number | undefined>;
} {
  const [position, setPosition] = useState<ReadingPosition | null>(
    () => controller?.position ?? null,
  );

  // A new controller (another book) starts from its own position, never
  // the previous book's.
  useEffect(() => {
    setPosition(controller?.position ?? null);
  }, [controller]);
  useControllerEvent(controller, 'positionChange', ({ position: pos }) => {
    setPosition(pos);
  });

  const save = useCallback(async () => {
    await controller?.savePosition();
  }, [controller]);
  const restore = useCallback(async () => controller?.restorePosition(), [controller]);

  return { position, save, restore };
}
