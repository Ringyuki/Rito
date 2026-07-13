import { describe, expect, it, vi } from 'vitest';
import type { Reader } from '@ritojs/core';
import { buildController } from '../src/controller/facade';
import type { Internals, Nav, RuntimeComponents } from '../src/controller/facade/types';
import { createInteractionModeManager } from '../src/controller/interaction-mode';
import type { ReaderControllerEvents } from '../src/controller/types';
import type { KeyboardManager } from '../src/keyboard/types';
import type { SelectionEngine } from '../src/interaction';
import { createDisposableCollection } from '../src/utils/disposable';
import { createEmitter } from '../src/utils/event-emitter';

describe('controller navigation surface', () => {
  it('does not expose navigation coordination methods at runtime', () => {
    const nav = createNavigationStub();
    const selectionMocks = {
      hasSelection: vi.fn<SelectionEngine['hasSelection']>(() => false),
      getText: vi.fn<SelectionEngine['getText']>(() => ''),
      getSelection: vi.fn<SelectionEngine['getSelection']>(() => null),
      getSourceLocator: vi.fn<SelectionEngine['getSourceLocator']>(() => null),
    };
    const internals = createInternalsStub(selectionMocks);
    const controller = buildController(
      internals,
      createEmitter<ReaderControllerEvents>(),
      createDisposableCollection(),
      createRuntimeStub(),
      {} as KeyboardManager,
      createInteractionModeManager('gesture'),
      nav,
      {} as HTMLCanvasElement,
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

    selectionMocks.hasSelection.mockReturnValue(true);
    selectionMocks.getText.mockReturnValue('live selection');
    selectionMocks.getSourceLocator.mockReturnValue({
      href: 'chapter.xhtml',
      sourceRange: {
        start: { nodePath: [0], textOffset: 1 },
        end: { nodePath: [0], textOffset: 2 },
      },
    });
    expect(controller.hasSelection).toBe(true);
    expect(controller.selectionText).toBe('live selection');
    expect(controller.selectionSourceLocator?.href).toBe('chapter.xhtml');
    expect(controller.paginationComplete).toBe(true);
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
    dispose: vi.fn(),
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

function createInternalsStub(
  selection: Pick<
    SelectionEngine,
    'hasSelection' | 'getText' | 'getSelection' | 'getSourceLocator'
  >,
): Internals {
  return {
    reader: createReaderStub(),
    currentSpread: 0,
    renderScale: 1,
    options: {},
    engines: {
      selection,
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
