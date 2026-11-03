// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReaderController } from '@ritojs/kit';
import { useRitoScrollView, type UseRitoScrollViewOptions } from '../src/hooks';

const { createScrollControllerMock } = vi.hoisted(() => ({
  createScrollControllerMock: vi.fn(),
}));

vi.mock('@ritojs/kit', () => ({
  createScrollController: createScrollControllerMock,
}));

type Listener = (data: unknown) => void;

/** A scroll view whose events the test raises. */
function fakeView() {
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

/** Pages over a reader whose layouts commit when the test says. */
function fakePages() {
  const committed = new Set<() => void>();
  let scrolled = false;
  const reader = {
    getScrollLayout: () =>
      scrolled ? { axis: 'down', windowLength: 600, chapters: [] } : undefined,
    setSpreadMode: vi.fn(() => true),
    navigateToLocator: vi.fn(() => Promise.resolve({ status: 'resolved' })),
    onLayoutCommitted: (listener: () => void) => {
      committed.add(listener);
      return () => committed.delete(listener);
    },
  };
  const pages = {
    reader,
    position: { sourceLocator: { href: 'two.xhtml' } },
    suspended: false,
    suspend: vi.fn(() => {
      pages.suspended = true;
    }),
    resume: vi.fn(() => {
      pages.suspended = false;
    }),
  };
  return {
    pages: pages as unknown as ReaderController,
    reader,
    suspend: pages.suspend,
    resume: pages.resume,
    /** The reader commits a layout, scrolled or not. */
    commit(isScrolled: boolean) {
      scrolled = isScrolled;
      for (const listener of [...committed]) listener();
    },
  };
}

type HookValue = ReturnType<typeof useRitoScrollView>;

let root: Root;
let host: HTMLElement;
let value: HookValue | null;

function Harness(props: { pages: ReaderController | null; options: UseRitoScrollViewOptions }) {
  const hook = useRitoScrollView(props.pages, props.options);
  value = hook;
  return <div ref={hook.containerRef} />;
}

function current(): HookValue {
  if (value === null) throw new Error('the hook rendered');
  return value;
}

/** Lets the hook's queued switches run. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  value = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  createScrollControllerMock.mockReset();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
});

describe('useRitoScrollView', () => {
  it('takes the pages reader, lays it out scrolled and shows it from where the pages were', async () => {
    const fixture = fakePages();
    const view = fakeView();
    createScrollControllerMock.mockReturnValue(view);
    act(() => {
      root.render(<Harness pages={fixture.pages} options={{ active: true, paged: 'double' }} />);
    });
    await settle();
    expect(fixture.suspend).toHaveBeenCalledOnce();
    expect(fixture.reader.setSpreadMode).toHaveBeenCalledWith('scrolled');
    // Nothing is made until the scrolled layout commits.
    expect(createScrollControllerMock).not.toHaveBeenCalled();
    expect(current().controller).toBeNull();

    fixture.commit(true);
    await settle();
    expect(createScrollControllerMock.mock.calls[0]?.[0]).toBe(fixture.reader);
    expect(view.scrollToLocator).toHaveBeenCalledWith({ href: 'two.xhtml' });
    expect(view.mount).toHaveBeenCalledWith(host.firstElementChild);
    expect(current().controller).toBe(view);
    expect(current().isLoading).toBe(false);
  });

  it('pages the reader again on the line the view was read at, then gives it back to the pages', async () => {
    const fixture = fakePages();
    const view = fakeView();
    createScrollControllerMock.mockReturnValue(view);
    act(() => {
      root.render(<Harness pages={fixture.pages} options={{ active: true, paged: 'single' }} />);
    });
    await settle();
    fixture.commit(true);
    await settle();
    act(() => {
      view.emit('position', { locator: { href: 'three.xhtml' } });
    });

    act(() => {
      root.render(<Harness pages={fixture.pages} options={{ active: false, paged: 'single' }} />);
    });
    await settle();
    expect(view.dispose).toHaveBeenCalledOnce();
    expect(fixture.reader.navigateToLocator).toHaveBeenCalledWith({ href: 'three.xhtml' });
    expect(fixture.reader.setSpreadMode).toHaveBeenLastCalledWith('single');
    // The pages wait for the paged layout.
    expect(fixture.resume).not.toHaveBeenCalled();

    fixture.commit(false);
    await settle();
    expect(fixture.resume).toHaveBeenCalledOnce();
    expect(current().controller).toBeNull();
  });

  it('only lets the view go when the pages it took the reader from are replaced', async () => {
    const fixture = fakePages();
    const view = fakeView();
    createScrollControllerMock.mockReturnValue(view);
    act(() => {
      root.render(<Harness pages={fixture.pages} options={{ active: true, paged: 'double' }} />);
    });
    await settle();
    fixture.commit(true);
    await settle();

    act(() => {
      root.render(<Harness pages={null} options={{ active: true, paged: 'double' }} />);
    });
    await settle();
    expect(view.dispose).toHaveBeenCalledOnce();
    expect(fixture.reader.navigateToLocator).not.toHaveBeenCalled();
    expect(fixture.resume).not.toHaveBeenCalled();
  });
});
