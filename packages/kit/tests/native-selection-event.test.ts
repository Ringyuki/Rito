import { describe, expect, it, vi } from 'vitest';
import type { ReaderTextSelectionInteractions } from '@ritojs/core';
import { createSelectionEngine } from '../src/interaction';
import type { ReaderControllerEvents } from '../src/controller/types';
import type { WiringDeps } from '../src/controller/core/wiring-deps';
import { wireEngineEvents } from '../src/controller/wiring/engine-events';
import { createDisposableCollection } from '../src/utils/disposable';
import { createEmitter } from '../src/utils/event-emitter';
import { caret, exactRange, flushMicrotasks, resolvedCaret } from './helpers/native-selection';

describe('native selection controller event', () => {
  it('reports exact selection independently of the legacy TextRange', async () => {
    const anchor = caret(1);
    const focus = caret(5);
    const range = exactRange(anchor, focus);
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(anchor))
      .mockResolvedValueOnce(resolvedCaret(focus));
    const capability: ReaderTextSelectionInteractions = {
      resolveCaret,
      resolveSameFlowRange: vi.fn().mockResolvedValue({ status: 'resolved', range }),
    };
    const selection = createSelectionEngine(capability);
    selection.setSpread({} as never, {} as never, {} as never, {
      spreadContentToPage: (x, y) => ({ pageIndex: 0, x, y }),
      pageContentToSpread: (_pageIndex, rect) => rect,
    });
    const emitter = createEmitter<ReaderControllerEvents>();
    const listener = vi.fn();
    const errorListener = vi.fn();
    emitter.on('selectionChange', listener);
    emitter.on('error', errorListener);
    const deps = {
      engines: {
        selection,
        search: {
          onResultsChange: () => () => undefined,
          onActiveResultChange: () => () => undefined,
        },
        position: null,
      },
      emitter,
      coordState: {
        mapper: {
          spreadContentRectToViewport: (rect: { x: number; y: number }) => ({
            ...rect,
            x: rect.x + 40,
            y: rect.y + 40,
          }),
        },
        annotationStore: null,
      },
      frameDriver: { markOverlayDirty: vi.fn() },
      getCurrentSpread: () => 0,
    } as unknown as WiringDeps;
    const disposables = createDisposableCollection();
    wireEngineEvents(deps, disposables);

    selection.handlePointerDown({ x: 1, y: 10 });
    selection.handlePointerUp({ x: 5, y: 10 });
    await flushMicrotasks();

    expect(listener).toHaveBeenLastCalledWith({
      range: null,
      sourceLocator: range.sourceLocator,
      hasSelection: true,
      text: 'selected text',
      rects: [{ x: 1, y: 2, width: 30, height: 18 }],
      viewportRects: [{ x: 41, y: 42, width: 30, height: 18 }],
      focusRect: { x: 45, y: 40, width: 0, height: 18 },
    });

    resolveCaret.mockRejectedValueOnce(new Error('selection read failed'));
    selection.handlePointerDown({ x: 2, y: 10 });
    await flushMicrotasks();
    expect(errorListener).toHaveBeenCalledWith({
      message: 'selection read failed',
      source: 'native-text-selection',
    });

    disposables.disposeAll();
  });
});
