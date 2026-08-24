import { describe, expect, it, vi } from 'vitest';
import type { ReaderOptions } from '@ritojs/core';
import type { ReadingPosition } from '@ritojs/kit';
import {
  loadInitialPosition,
  readerOptionsWithInitialPosition,
  type InitialPositionLoad,
} from '../src/hooks/use-rito-reader-position';

const readerOptions: ReaderOptions = { width: 800, height: 600 };

function initial(position: ReadingPosition): InitialPositionLoad {
  return { serialized: JSON.stringify(position), position, shouldHydrate: true };
}

function legacyPosition(manifestHref?: string): ReadingPosition {
  return {
    locator: {
      spineIdref: 'chapter-3',
      chapterProgress: 0.75,
      ...(manifestHref ? { manifestHref } : {}),
      sourcePoint: { nodePath: [2], textOffset: 5 },
    },
    projection: { spreadIndex: 2, pageIndex: 2 },
    progress: 0.4,
    timestamp: 1,
  };
}

describe('initial reader position preparation', () => {
  it('converts a legacy manifest locator into a core initial locator', () => {
    expect(
      readerOptionsWithInitialPosition(readerOptions, initial(legacyPosition('Text/legacy.xhtml'))),
    ).toEqual({
      ...readerOptions,
      initialLocator: {
        href: 'Text/legacy.xhtml',
        progression: 0.75,
        sourcePoint: { nodePath: [2], textOffset: 5 },
      },
    });
  });

  it('leaves a legacy locator without a manifest href for later hydration', () => {
    expect(readerOptionsWithInitialPosition(readerOptions, initial(legacyPosition()))).toBe(
      readerOptions,
    );
  });

  it('treats a storage read failure as an empty best-effort hydration', async () => {
    const load = vi.fn(() => Promise.reject(new Error('storage unavailable')));

    await expect(
      loadInitialPosition({
        reader: readerOptions,
        controller: {
          positionStorage: {
            load,
            save: vi.fn(() => Promise.resolve()),
            clear: vi.fn(() => Promise.resolve()),
          },
        },
      }),
    ).resolves.toEqual({ serialized: null, position: undefined, shouldHydrate: true });
    expect(load).toHaveBeenCalledOnce();
  });
});
