import { describe, expect, it, vi } from 'vitest';
import type { Reader } from '@ritojs/core';
import { buildController } from '../src/controller/facade';
import type { Internals, Nav, RuntimeComponents } from '../src/controller/facade/types';
import { createInteractionModeManager } from '../src/controller/interaction-mode';
import type { ReaderControllerEvents } from '../src/controller/types';
import type { KeyboardManager } from '../src/keyboard/types';
import { createDisposableCollection } from '../src/utils/disposable';
import { createEmitter } from '../src/utils/event-emitter';

describe('controller navigation surface', () => {
  it('does not expose navigation coordination methods at runtime', () => {
    const nav = createNavigationStub();
    const controller = buildController(
      createInternalsStub(),
      createEmitter<ReaderControllerEvents>(),
      createDisposableCollection(),
      createRuntimeStub(),
      {} as KeyboardManager,
      createInteractionModeManager('gesture'),
      nav,
      {},
      {} as HTMLCanvasElement,
      createReaderStub(),
    );

    expect(Object.keys(controller)).toEqual(
      expect.arrayContaining([
        'goToSpread',
        'nextSpread',
        'prevSpread',
        'navigateToTocEntry',
        'jumpToSpread',
      ]),
    );
    for (const internalMethod of [
      'startGestureNavigation',
      'notifyContentReady',
      'notifyLayoutCommitted',
    ]) {
      expect(controller).not.toHaveProperty(internalMethod);
    }
  });
});

function createNavigationStub(): Nav {
  return {
    goToSpread: vi.fn(),
    startGestureNavigation: vi.fn(),
    nextSpread: vi.fn(),
    prevSpread: vi.fn(),
    navigateToTocEntry: vi.fn(),
    jumpToSpread: vi.fn(),
    notifyContentReady: vi.fn(),
    notifyLayoutCommitted: vi.fn(),
  } as unknown as Nav;
}

function createReaderStub(): Reader {
  return {
    metadata: {},
    toc: [],
    spreads: [],
    pages: [],
    totalSpreads: 0,
    renderSpreadTo: vi.fn(),
  } as unknown as Reader;
}

function createInternalsStub(): Internals {
  return {
    reader: createReaderStub(),
    currentSpread: 0,
    renderScale: 1,
    options: {},
    engines: {
      selection: { getText: vi.fn(() => ''), getSelection: vi.fn(() => null) },
      search: { getResults: vi.fn(() => []), getActiveIndex: vi.fn(() => -1) },
      position: null,
    },
    coordState: { annotationStore: null },
    restoreCompleted: false,
  } as unknown as Internals;
}

function createRuntimeStub(): RuntimeComponents {
  return {
    td: { configure: vi.fn() },
    frameDriver: {},
    pool: {},
    surface: {},
  } as unknown as RuntimeComponents;
}
