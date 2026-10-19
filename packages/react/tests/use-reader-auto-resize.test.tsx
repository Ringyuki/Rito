// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReaderMargin } from '@ritojs/core';
import type { ReaderController } from '@ritojs/kit';
import { useReaderAutoResize } from '../src/hooks/use-reader-auto-resize';

describe('useReaderAutoResize', () => {
  let container: HTMLDivElement;
  let root: Root;
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 400,
      height: 600,
    } as DOMRect);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lays the book out again when one side of the margins changes, and not for equal ones', () => {
    const resize = vi.fn();
    const controller = { resize, setRenderScale: vi.fn() } as unknown as ReaderController;
    const render = (margin: ReaderMargin): void => {
      act(() => {
        root.render(<Host controller={controller} margin={margin} />);
      });
      for (const frame of frames.splice(0)) frame(0);
    };

    render({ top: 10, right: 20, bottom: 30, left: 40 });
    render({ top: 12, right: 20, bottom: 30, left: 40 });
    render({ top: 12, right: 20, bottom: 30, left: 40 });

    expect(resize.mock.calls).toEqual([
      [400, 600, { top: 10, right: 20, bottom: 30, left: 40 }],
      [400, 600, { top: 12, right: 20, bottom: 30, left: 40 }],
    ]);
  });
});

function Host(props: { controller: ReaderController; margin: ReaderMargin }) {
  const ref = useReaderAutoResize(props.controller, { margin: props.margin });
  return <div ref={ref} />;
}
