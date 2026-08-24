import type { ReaderLocator, ReaderOptions } from '@ritojs/core';
import { parseReadingPosition, type ReaderController, type ReadingPosition } from '@ritojs/kit';
import type { UseRitoReaderOptions } from './use-rito-reader-model';

export interface InitialPositionLoad {
  readonly serialized: string | null;
  readonly position: ReadingPosition | undefined;
  readonly shouldHydrate: boolean;
}

export async function loadInitialPosition(
  options: UseRitoReaderOptions,
): Promise<InitialPositionLoad> {
  if (options.initialPosition !== undefined) {
    const position = options.initialPosition ?? undefined;
    return {
      serialized: position ? JSON.stringify(position) : null,
      position,
      shouldHydrate: true,
    };
  }

  const storage = options.controller?.positionStorage;
  if (!storage) return { serialized: null, position: undefined, shouldHydrate: false };
  let serialized: string | null;
  try {
    serialized = await storage.load();
  } catch {
    serialized = null;
  }
  return {
    serialized,
    position: serialized ? parseReadingPosition(serialized) : undefined,
    shouldHydrate: true,
  };
}

export async function hydrateInitialPosition(
  controller: ReaderController,
  initial: InitialPositionLoad,
): Promise<void> {
  if (!initial.shouldHydrate) return;
  try {
    await controller.restorePosition(initial.serialized);
  } catch {
    // Optional persisted state must not hide an otherwise usable reader stack.
  }
}

export function readerOptionsWithInitialPosition(
  options: ReaderOptions,
  initial: InitialPositionLoad,
): ReaderOptions {
  const initialLocator = resolveInitialLocator(initial.position);
  return initialLocator ? { ...options, initialLocator } : options;
}

function resolveInitialLocator(position: ReadingPosition | undefined): ReaderLocator | undefined {
  if (position?.sourceLocator) return position.sourceLocator;
  const legacy = position?.locator;
  if (!legacy?.manifestHref) return undefined;
  return {
    href: legacy.manifestHref,
    progression: legacy.chapterProgress,
    ...(legacy.sourcePoint ? { sourcePoint: legacy.sourcePoint } : {}),
  };
}
