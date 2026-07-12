// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReaderController, ReaderControllerEvents } from '@ritojs/kit';
import { useSelection } from '../src/hooks/use-selection';

type SelectionValue = ReturnType<typeof useSelection>;

describe('useSelection', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('clears selection state when the controller changes', () => {
    const first = controllerStub();
    const second = controllerStub();
    let latest: SelectionValue | undefined;
    const render = (controller: ReaderController | null) => {
      act(() => {
        root.render(
          <Harness
            controller={controller}
            onValue={(value) => {
              latest = value;
            }}
          />,
        );
      });
    };

    render(first.controller);
    act(() => {
      first.emit('selectionChange', {
        range: null,
        sourceLocator: {
          href: 'old.xhtml',
          sourceRange: {
            start: { nodePath: [0], textOffset: 0 },
            end: { nodePath: [0], textOffset: 3 },
          },
        },
        hasSelection: true,
        text: 'old',
        rects: [{ x: 1, y: 2, width: 3, height: 4 }],
        viewportRects: [{ x: 1, y: 2, width: 3, height: 4 }],
        focusRect: { x: 4, y: 2, width: 0, height: 4 },
      });
    });
    expect(latest?.hasSelection).toBe(true);

    render(second.controller);

    expect(latest).toMatchObject({
      range: null,
      sourceLocator: null,
      text: '',
      rects: [],
      viewportRects: [],
      focusRect: null,
      hasSelection: false,
    });
  });
});

function Harness({
  controller,
  onValue,
}: {
  readonly controller: ReaderController | null;
  readonly onValue: (value: SelectionValue) => void;
}) {
  onValue(useSelection(controller));
  return null;
}

function controllerStub(): {
  readonly controller: ReaderController;
  emit<K extends keyof ReaderControllerEvents>(event: K, value: ReaderControllerEvents[K]): void;
} {
  const listeners = new Map<keyof ReaderControllerEvents, Set<(value: never) => void>>();
  const controller = {
    clearSelection: vi.fn(),
    on(event: keyof ReaderControllerEvents, listener: (value: never) => void) {
      const current = listeners.get(event) ?? new Set();
      current.add(listener);
      listeners.set(event, current);
      return () => current.delete(listener);
    },
  } as unknown as ReaderController;
  return {
    controller,
    emit(event, value) {
      for (const listener of listeners.get(event) ?? []) listener(value as never);
    },
  };
}
