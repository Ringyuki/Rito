// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReaderController, ReaderControllerEvents, SelectionHandleDrag } from '@ritojs/kit';
import { Reader } from '../src/components/reader';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Reader touch selection handles', () => {
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

  it('shows exact caret handles only after touch input and applies renderScale', () => {
    const stub = controllerStub();
    act(() => {
      root.render(<Reader controller={stub.controller} />);
    });
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();

    act(() => {
      canvas?.dispatchEvent(new Event('touchstart', { bubbles: true }));
      stub.emit('selectionChange', selectionEvent());
    });

    const start = container.querySelector<HTMLElement>('[data-rito-selection-handle="start"]');
    const end = container.querySelector<HTMLElement>('[data-rito-selection-handle="end"]');
    expect(start).not.toBeNull();
    expect(end).not.toBeNull();
    expect(start?.style.left).toBe('-2px');
    expect(start?.style.top).toBe('-2px');
    expect(end?.style.left).toBe('58px');
    expect(end?.style.top).toBe('18px');
  });

  it('does not show native touch affordances for a non-touch selection', () => {
    const stub = controllerStub();
    act(() => {
      root.render(<Reader controller={stub.controller} />);
    });
    act(() => {
      stub.emit('selectionChange', selectionEvent());
    });

    expect(container.querySelector('[data-rito-selection-handle]')).toBeNull();
  });

  it('uses the direct marked surface with a bordered root and ignores a nested reader', () => {
    const stub = controllerStub();
    act(() => {
      root.render(<Reader controller={stub.controller} />);
    });
    const readerRoot = container.firstElementChild as HTMLDivElement;
    const surface = readerRoot.querySelector<HTMLCanvasElement>(
      'canvas[data-rito-reader-surface="true"]',
    );
    const nestedRoot = document.createElement('div');
    const nestedCanvas = document.createElement('canvas');
    nestedCanvas.setAttribute('data-rito-reader-surface', 'true');
    nestedRoot.appendChild(nestedCanvas);
    readerRoot.insertBefore(nestedRoot, surface);
    Object.defineProperties(readerRoot, {
      clientLeft: { configurable: true, value: 4 },
      clientTop: { configurable: true, value: 6 },
    });
    vi.spyOn(readerRoot, 'getBoundingClientRect').mockReturnValue(rect(100, 50));
    vi.spyOn(surface as HTMLCanvasElement, 'getBoundingClientRect').mockReturnValue(rect(120, 80));
    vi.spyOn(nestedCanvas, 'getBoundingClientRect').mockReturnValue(rect(500, 500));

    act(() => {
      surface?.dispatchEvent(new Event('touchstart', { bubbles: true }));
      stub.emit('selectionChange', selectionEvent());
    });

    const start = container.querySelector<HTMLElement>('[data-rito-selection-handle="start"]');
    expect(start?.style.left).toBe('14px');
    expect(start?.style.top).toBe('22px');
  });

  it('cancels an active handle drag when input modality switches away from touch', () => {
    const session = handleDragStub();
    const stub = controllerStub(session);
    act(() => {
      root.render(<Reader controller={stub.controller} />);
    });
    showTouchSelection(container, stub);
    const readerRoot = container.firstElementChild as HTMLDivElement;
    const handle = requireHandle(container, 'end');
    installPointerCaptureStub(handle);

    act(() => {
      handle.dispatchEvent(pointerEvent('pointerdown', 'touch'));
    });
    expect(stub.beginHandleDrag).toHaveBeenCalledOnce();

    act(() => {
      readerRoot.dispatchEvent(pointerEvent('pointerdown', 'mouse'));
    });

    expect(session.cancel).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-rito-selection-handle]')).toBeNull();
  });

  it('cancels an active handle drag when the controller is replaced', () => {
    const session = handleDragStub();
    const first = controllerStub(session);
    const second = controllerStub();
    act(() => {
      root.render(<Reader controller={first.controller} />);
    });
    showTouchSelection(container, first);
    const handle = requireHandle(container, 'end');
    installPointerCaptureStub(handle);
    act(() => {
      handle.dispatchEvent(pointerEvent('pointerdown', 'touch'));
      root.render(<Reader controller={second.controller} />);
    });

    expect(session.cancel).toHaveBeenCalledOnce();
  });

  it('keeps the captured handle mounted at its latest visible caret during spread transfer', () => {
    const session = handleDragStub();
    const stub = controllerStub(session);
    act(() => {
      root.render(<Reader controller={stub.controller} />);
    });
    showTouchSelection(container, stub);
    const captured = requireHandle(container, 'end');
    installPointerCaptureStub(captured);

    act(() => {
      captured.dispatchEvent(pointerEvent('pointerdown', 'touch'));
      stub.emit('selectionChange', selectionEvent(emptyHandleProjection('end')));
    });

    expect(requireHandle(container, 'end')).toBe(captured);
    expect(captured.style.left).toBe('58px');

    act(() => {
      stub.emit('selectionChange', selectionEvent(crossedHandleProjection()));
    });
    expect(requireHandle(container, 'end')).toBe(captured);
    expect(captured.style.left).toBe('108px');

    act(() => {
      stub.emit('selectionChange', selectionEvent(emptyHandleProjection('start')));
    });
    expect(requireHandle(container, 'end')).toBe(captured);
    expect(captured.style.left).toBe('108px');
    expect(session.cancel).not.toHaveBeenCalled();
  });
});

function showTouchSelection(
  container: HTMLDivElement,
  stub: ReturnType<typeof controllerStub>,
): void {
  const surface = container.querySelector<HTMLCanvasElement>(
    'canvas[data-rito-reader-surface="true"]',
  );
  act(() => {
    surface?.dispatchEvent(new Event('touchstart', { bubbles: true }));
    stub.emit('selectionChange', selectionEvent());
  });
}

function requireHandle(container: HTMLDivElement, edge: 'start' | 'end'): HTMLDivElement {
  const handle = container.querySelector<HTMLDivElement>(`[data-rito-selection-handle="${edge}"]`);
  if (!handle) throw new Error(`Missing ${edge} selection handle`);
  return handle;
}

function installPointerCaptureStub(handle: HTMLDivElement): void {
  Object.defineProperties(handle, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  });
}

function pointerEvent(type: string, pointerType: string): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    buttons: 1,
    clientX: 10,
    clientY: 10,
    pointerId: 7,
    pointerType,
  });
}

function handleDragStub() {
  return { update: vi.fn(), finish: vi.fn(), cancel: vi.fn() };
}

function rect(left: number, top: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left,
    bottom: top,
    width: 0,
    height: 0,
    toJSON: () => undefined,
  } as DOMRect;
}

function selectionEvent(
  handles: ReaderControllerEvents['selectionChange']['handles'] = defaultHandleProjection(),
): ReaderControllerEvents['selectionChange'] {
  return {
    range: null,
    sourceLocator: {
      href: 'chapter.xhtml',
      sourceRange: {
        start: { nodePath: [0], textOffset: 0 },
        end: { nodePath: [0], textOffset: 4 },
      },
    },
    hasSelection: true,
    text: 'text',
    rects: [{ x: 10, y: 10, width: 30, height: 10 }],
    viewportRects: [{ x: 10, y: 10, width: 30, height: 10 }],
    focusRect: { x: 40, y: 10, width: 0, height: 10 },
    handles,
  };
}

function defaultHandleProjection(): NonNullable<
  ReaderControllerEvents['selectionChange']['handles']
> {
  return {
    start: { x: 10, y: 10, width: 0, height: 10 },
    end: { x: 40, y: 10, width: 0, height: 10 },
    focusEdge: 'end',
  };
}

function emptyHandleProjection(
  focusEdge: 'start' | 'end',
): NonNullable<ReaderControllerEvents['selectionChange']['handles']> {
  return { start: null, end: null, focusEdge };
}

function crossedHandleProjection(): NonNullable<
  ReaderControllerEvents['selectionChange']['handles']
> {
  return {
    start: { x: 65, y: 10, width: 0, height: 10 },
    end: { x: 40, y: 10, width: 0, height: 10 },
    focusEdge: 'start',
  };
}

function controllerStub(handleDrag: SelectionHandleDrag | null = null): {
  readonly controller: ReaderController;
  readonly beginHandleDrag: ReturnType<typeof vi.fn>;
  emit<K extends keyof ReaderControllerEvents>(event: K, value: ReaderControllerEvents[K]): void;
} {
  const listeners = new Map<keyof ReaderControllerEvents, Set<(value: never) => void>>();
  const canvas = document.createElement('canvas');
  const beginHandleDrag = vi.fn(() => handleDrag);
  const controller = {
    renderScale: 2,
    mount: vi.fn((target: HTMLElement) => {
      canvas.setAttribute('data-rito-reader-surface', 'true');
      target.appendChild(canvas);
    }),
    clearSelection: vi.fn(),
    beginSelectionHandleDrag: beginHandleDrag,
    on(event: keyof ReaderControllerEvents, listener: (value: never) => void) {
      const current = listeners.get(event) ?? new Set();
      current.add(listener);
      listeners.set(event, current);
      return () => current.delete(listener);
    },
  } as unknown as ReaderController;
  return {
    controller,
    beginHandleDrag,
    emit(event, value) {
      for (const listener of listeners.get(event) ?? []) listener(value as never);
    },
  };
}
