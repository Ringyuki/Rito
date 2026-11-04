// @vitest-environment happy-dom

import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScrollController, SelectionHandleDrag, SelectionHandleState } from '@ritojs/kit';
import { ScrollSelectionHandles } from '../src/components/scroll-selection-handles';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Listener = (data: unknown) => void;

const HANDLES: SelectionHandleState = {
  start: { x: 30, y: 50, width: 0, height: 18 },
  end: { x: 120, y: 130, width: 0, height: 18 },
  focusEdge: 'end',
};

/** A scrolled view whose events the test raises. */
function scrollStub() {
  const listeners = new Map<string, Listener[]>();
  const canvas = document.createElement('canvas');
  let handles: SelectionHandleState | null = null;
  const drag: SelectionHandleDrag = { update: vi.fn(), finish: vi.fn(), cancel: vi.fn() };
  const controller = {
    canvas,
    get selection() {
      return handles ? { selectedText: 'words' } : null;
    },
    selectionHandles: () => handles,
    beginSelectionHandleDrag: vi.fn(() => drag),
    on(event: string, listener: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return () => undefined;
    },
  };
  const emit = (event: string, data: unknown) => {
    for (const listener of listeners.get(event) ?? []) listener(data);
  };
  return {
    controller: controller as unknown as ScrollController,
    drag,
    canvas,
    select(next: SelectionHandleState | null) {
      handles = next;
      emit('selection', {
        range: next ? {} : null,
        text: next ? 'words' : '',
        selecting: false,
        rects: [],
        handles: next,
      });
    },
    scrolled(next: SelectionHandleState) {
      handles = next;
      emit('scroll', { offset: 10, extent: 1000, viewport: 600, progress: 0.01 });
    },
    begin: controller.beginSelectionHandleDrag,
  };
}

function View({ controller }: { controller: ScrollController }) {
  const root = useRef<HTMLDivElement | null>(null);
  return (
    <div ref={root}>
      {/* The view's canvas, which the controller put here. */}
      <span
        ref={(node) => {
          node?.parentElement?.appendChild(controller.canvas);
        }}
      />
      <ScrollSelectionHandles controller={controller} rootRef={root} touchInput />
    </div>
  );
}

describe('scrolled selection handles', () => {
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

  it('shows the ends of a selection and follows them as the strip scrolls', () => {
    const stub = scrollStub();
    act(() => {
      root.render(<View controller={stub.controller} />);
    });
    expect(container.querySelector('[data-rito-selection-handle]')).toBeNull();
    act(() => {
      stub.select(HANDLES);
    });
    const end = () => container.querySelector<HTMLElement>('[data-rito-selection-handle="end"]');
    expect(container.querySelector('[data-rito-selection-handle="start"]')).not.toBeNull();
    // The end's knob sits below its caret: 130 + 18 down, less the knob's 22.
    expect(end()?.style.top).toBe('126px');
    act(() => {
      stub.scrolled({ ...HANDLES, end: { x: 120, y: 90, width: 0, height: 18 } });
    });
    expect(end()?.style.top).toBe('86px');
    act(() => {
      stub.select(null);
    });
    expect(container.querySelector('[data-rito-selection-handle]')).toBeNull();
  });

  it('hangs the knobs off the right and left ends of carets across a vertical line', () => {
    const stub = scrollStub();
    act(() => {
      root.render(<View controller={stub.controller} />);
    });
    act(() => {
      stub.select({
        start: { x: 300, y: 40, width: 23, height: 0 },
        end: { x: 254, y: 120, width: 23, height: 0 },
        focusEdge: 'end',
      });
    });
    const handle = (edge: string) =>
      container.querySelector<HTMLElement>(`[data-rito-selection-handle="${edge}"]`);
    // The start's knob at its caret's right end, the end's at its left end,
    // each at the caret's height, less the knob's 22.
    expect([handle('start')?.style.left, handle('start')?.style.top]).toEqual(['301px', '18px']);
    expect([handle('end')?.style.left, handle('end')?.style.top]).toEqual(['232px', '98px']);
  });

  it('drags an end through the view', () => {
    const stub = scrollStub();
    act(() => {
      root.render(<View controller={stub.controller} />);
    });
    act(() => {
      stub.select(HANDLES);
    });
    const end = container.querySelector<HTMLElement>('[data-rito-selection-handle="end"]');
    expect(end).not.toBeNull();
    act(() => {
      end?.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerType: 'touch',
          pointerId: 1,
          clientX: 120,
          clientY: 148,
        }),
      );
    });
    expect(stub.begin).toHaveBeenCalledWith('end', { clientX: 120, clientY: 148 });
  });
});
