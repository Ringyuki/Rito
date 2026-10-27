// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRitoScrollReader, type UseRitoScrollReaderOptions } from '../src/hooks';

const { createReaderMock, createScrollControllerMock } = vi.hoisted(() => ({
  createReaderMock: vi.fn(),
  createScrollControllerMock: vi.fn(),
}));

vi.mock('@ritojs/core', () => ({
  createReader: createReaderMock,
}));

vi.mock('@ritojs/kit', () => ({
  createScrollController: createScrollControllerMock,
  canDrawWithWebGl2: () => true,
  WebGlUnavailableError: class WebGlUnavailableError extends Error {},
}));

type Listener = (data: unknown) => void;

/** A scroll view whose events the test raises. */
function fakeController() {
  const listeners = new Map<string, Listener[]>();
  return {
    mount: vi.fn(),
    dispose: vi.fn(),
    scrollToLocator: vi.fn(() => Promise.resolve(true)),
    on(event: string, listener: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return () => {
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((each) => each !== listener),
        );
      };
    },
    emit(event: string, data: unknown) {
      for (const listener of listeners.get(event) ?? []) listener(data);
    },
  };
}

function fakeReader(title: string) {
  return {
    totalSpreads: 3,
    metadata: { title },
    toc: [{ label: 'One', href: 'one.xhtml', children: [] }],
    onLayoutCommitted: () => () => undefined,
    dispose: vi.fn(() => Promise.resolve()),
  };
}

type HookValue = ReturnType<typeof useRitoScrollReader>;

let root: Root;
let host: HTMLElement;
let value: HookValue | null;

function Harness({ options }: { options: UseRitoScrollReaderOptions }) {
  const hook = useRitoScrollReader(options);
  value = hook;
  return <div ref={hook.containerRef} />;
}

function current(): HookValue {
  if (value === null) throw new Error('the hook rendered');
  return value;
}

beforeEach(() => {
  value = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  createReaderMock.mockReset();
  createScrollControllerMock.mockReset();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
});

const OPTIONS: UseRitoScrollReaderOptions = {
  reader: { width: 400, height: 600, spread: undefined } as UseRitoScrollReaderOptions['reader'],
  initialLocator: { href: 'two.xhtml' },
};

describe('useRitoScrollReader', () => {
  it('opens the book scrolled, shows its view in the container and follows it', async () => {
    const reader = fakeReader('A book');
    const controller = fakeController();
    createReaderMock.mockResolvedValue(reader);
    createScrollControllerMock.mockReturnValue(controller);
    act(() => {
      root.render(<Harness options={OPTIONS} />);
    });
    await act(async () => {
      await current().load(new ArrayBuffer(1));
    });
    expect(createReaderMock.mock.calls[0]?.[2]).toMatchObject({ width: 400, spread: 'scrolled' });
    expect(controller.mount).toHaveBeenCalledWith(host.firstElementChild);
    expect(controller.scrollToLocator).toHaveBeenCalledWith({ href: 'two.xhtml' });
    expect(current()).toMatchObject({
      isLoaded: true,
      isLoading: false,
      error: null,
      metadata: { title: 'A book' },
      progress: 0,
      position: null,
      selection: null,
    });
    expect(current().controller).toBe(controller);

    act(() => {
      controller.emit('scroll', { offset: 300, extent: 1_200, viewport: 600, progress: 0.5 });
      controller.emit('position', { locator: { href: 'two.xhtml', progression: 0.4 } });
      controller.emit('selection', {
        range: { selectedText: 'words' },
        text: 'words',
        selecting: false,
        rects: [{ x: 1, y: 2, width: 3, height: 4 }],
      });
    });
    expect(current().progress).toBe(0.5);
    expect(current().position).toEqual({ href: 'two.xhtml', progression: 0.4 });
    expect(current().selection?.text).toBe('words');
    act(() => {
      controller.emit('selection', { range: null, text: '', selecting: false, rects: [] });
    });
    expect(current().selection).toBeNull();
  });

  it('lets a book go when another opens and when it unmounts', async () => {
    const first = { reader: fakeReader('First'), controller: fakeController() };
    const second = { reader: fakeReader('Second'), controller: fakeController() };
    createReaderMock.mockResolvedValueOnce(first.reader).mockResolvedValueOnce(second.reader);
    createScrollControllerMock
      .mockReturnValueOnce(first.controller)
      .mockReturnValueOnce(second.controller);
    act(() => {
      root.render(<Harness options={OPTIONS} />);
    });
    await act(async () => {
      await current().load(new ArrayBuffer(1));
    });
    await act(async () => {
      await current().load(new ArrayBuffer(2));
    });
    expect(first.controller.dispose).toHaveBeenCalled();
    expect(first.reader.dispose).toHaveBeenCalled();
    expect(current().metadata).toEqual({ title: 'Second' });
    act(() => {
      root.unmount();
    });
    await vi.waitFor(() => {
      expect(second.reader.dispose).toHaveBeenCalled();
    });
    expect(second.controller.dispose).toHaveBeenCalled();
    root = createRoot(host);
  });

  it('says why a book could not be opened', async () => {
    createReaderMock.mockRejectedValue(new Error('not an EPUB'));
    act(() => {
      root.render(<Harness options={OPTIONS} />);
    });
    await act(async () => {
      await current().load(new ArrayBuffer(1));
    });
    expect(current()).toMatchObject({ isLoaded: false, isLoading: false, error: 'not an EPUB' });
  });
});
