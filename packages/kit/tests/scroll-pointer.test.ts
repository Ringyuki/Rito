// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { runFrames, selectingView, stubScrollFrames } from './helpers/scroll-view';

stubScrollFrames();

describe('scroll controller pointing', () => {
  it('says which of the app highlights a tap and a resting mouse are on, the top one first', async () => {
    const { canvas, controller, pointer } = selectingView();
    controller.mount(document.body);
    controller.scrollTo(500);
    runFrames();
    controller.setHighlights([
      { id: 'under', rects: [{ pageIndex: 1, x: 0, y: 0, width: 200, height: 40 }], color: 'red' },
      {
        id: 'over',
        rects: [
          { pageIndex: 1, x: 0, y: 0, width: 40, height: 18 },
          { pageIndex: 1, x: 0, y: 20, width: 30, height: 18 },
        ],
        color: 'blue',
        zIndex: 1,
      },
    ]);
    runFrames();
    const taps: { highlight: unknown }[] = [];
    controller.on('tap', (tapped) => taps.push(tapped));
    const hovers: unknown[] = [];
    controller.on('highlightHover', ({ highlight }) => hovers.push(highlight?.id ?? null));

    // Page 1's content box starts at view (20, 130): both highlights are under (30, 135).
    canvas.dispatchEvent(pointer('pointerdown', 30, 135));
    canvas.dispatchEvent(pointer('pointerup', 30, 135));
    await vi.waitFor(() => {
      expect(taps).toHaveLength(1);
    });
    // The top one, bounded over its rects on that page.
    expect(taps[0]?.highlight).toEqual({
      id: 'over',
      bounds: { x: 20, y: 130, width: 40, height: 38 },
    });

    canvas.dispatchEvent(pointer('pointermove', 30, 135));
    canvas.dispatchEvent(pointer('pointermove', 32, 136));
    canvas.dispatchEvent(pointer('pointermove', 150, 140));
    canvas.dispatchEvent(pointer('pointermove', 300, 400));
    canvas.dispatchEvent(new PointerEvent('pointerleave'));
    expect(hovers).toEqual(['over', 'under', null]);

    canvas.dispatchEvent(pointer('pointerdown', 300, 400));
    canvas.dispatchEvent(pointer('pointerup', 300, 400));
    await vi.waitFor(() => {
      expect(taps).toHaveLength(2);
    });
    expect(taps[1]?.highlight).toBeNull();
    controller.dispose();
  });
  it('moves the hovered highlight with the strip under a resting mouse', () => {
    const { canvas, controller, pointer } = selectingView();
    controller.mount(document.body);
    controller.scrollTo(500);
    runFrames();
    controller.setHighlights([
      { id: 'a', rects: [{ pageIndex: 1, x: 0, y: 0, width: 40, height: 18 }], color: 'red' },
    ]);
    const hovers: unknown[] = [];
    controller.on('highlightHover', ({ highlight }) => hovers.push(highlight?.bounds.y ?? null));
    canvas.dispatchEvent(pointer('pointermove', 30, 135));
    // Ten pixels on, the highlight is ten pixels up, still under the mouse; then gone from under it.
    controller.scrollTo(510);
    runFrames();
    controller.scrollTo(600);
    runFrames();
    expect(hovers).toEqual([130, 120, null]);
    controller.dispose();
  });
  it('moves a page as the page keys do: the view less two lines', () => {
    const { canvas, controller } = selectingView();
    controller.mount(document.body);
    runFrames();
    expect(controller.pageLength).toBe(600 - 80);
    controller.scrollBy(controller.pageLength);
    runFrames();
    expect(controller.offset).toBe(520);
    // Read as the view is, not as it was made.
    Object.defineProperty(canvas, 'clientHeight', { value: 300 });
    expect(controller.pageLength).toBe(220);
    controller.dispose();
  });
});
