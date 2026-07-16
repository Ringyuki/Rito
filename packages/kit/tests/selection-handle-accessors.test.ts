import { describe, expect, it, vi } from 'vitest';
import { buildSelectionAccessors } from '../src/controller/facade/selection-accessors';
import type { Internals } from '../src/controller/facade/types';

describe('selection handle controller facade', () => {
  it('keeps the initial grab offset while converting client input to spread content', () => {
    const nativeDrag = { update: vi.fn(), finish: vi.fn(), cancel: vi.fn() };
    const cssToSpreadContent = vi.fn((x: number, y: number) => ({ x: x / 2, y: y / 2 }));
    const beginHandleDrag = vi.fn(() => nativeDrag);
    const internals = {
      renderScale: 2,
      engines: {
        selection: {
          getHandleCarets: () => ({
            start: { x: 10, y: 20, width: 0, height: 10 },
            end: { x: 30, y: 20, width: 0, height: 10 },
            focusEdge: 'end',
          }),
          beginHandleDrag,
        },
      },
      coordState: {
        mapper: {
          spreadContentRectToViewport: (rect: { x: number; y: number }) => ({
            ...rect,
            x: rect.x + 40,
            y: rect.y + 40,
          }),
          cssToSpreadContent,
        },
      },
    } as unknown as Internals;
    const canvas = {
      getBoundingClientRect: () => ({ left: 100, top: 50 }),
    } as unknown as HTMLCanvasElement;
    const accessors = buildSelectionAccessors(internals, canvas);

    // End caret center is (240, 180) in client space; grab it 10px right / 15px below.
    const drag = accessors.beginSelectionHandleDrag('end', { clientX: 250, clientY: 195 });
    expect(drag).not.toBeNull();
    drag?.update({ clientX: 270, clientY: 215 });
    drag?.finish({ clientX: 290, clientY: 235 });

    expect(beginHandleDrag).toHaveBeenCalledWith('end');
    expect(cssToSpreadContent).toHaveBeenNthCalledWith(1, 160, 150);
    expect(cssToSpreadContent).toHaveBeenNthCalledWith(2, 180, 170);
    expect(nativeDrag.update).toHaveBeenCalledWith({ x: 80, y: 75 });
    expect(nativeDrag.finish).toHaveBeenCalledWith({ x: 90, y: 85 });
    drag?.cancel();
    expect(nativeDrag.cancel).not.toHaveBeenCalled();
  });

  it('rejects unavailable or non-finite drag origins', () => {
    const beginHandleDrag = vi.fn();
    const internals = {
      engines: {
        selection: {
          getHandleCarets: () => null,
          beginHandleDrag,
        },
      },
      coordState: { mapper: null },
    } as unknown as Internals;
    const accessors = buildSelectionAccessors(internals, {} as HTMLCanvasElement);

    expect(
      accessors.beginSelectionHandleDrag('start', { clientX: Number.NaN, clientY: 0 }),
    ).toBeNull();
    expect(accessors.beginSelectionHandleDrag('start', { clientX: 0, clientY: 0 })).toBeNull();
    expect(beginHandleDrag).not.toHaveBeenCalled();
  });

  it('cancels a handle press released at its origin without resolving another caret', () => {
    const fixture = handleAccessorsFixture();
    const drag = fixture.accessors.beginSelectionHandleDrag('start', fixture.origin);

    drag?.update(fixture.origin);
    drag?.finish(fixture.origin);

    expect(fixture.nativeDrag.update).not.toHaveBeenCalled();
    expect(fixture.nativeDrag.finish).not.toHaveBeenCalled();
    expect(fixture.nativeDrag.cancel).toHaveBeenCalledOnce();
    expect(fixture.cssToSpreadContent).not.toHaveBeenCalled();
  });

  it('uses a changed release coordinate even when no pointermove was delivered', () => {
    const fixture = handleAccessorsFixture();
    const drag = fixture.accessors.beginSelectionHandleDrag('start', fixture.origin);

    drag?.finish({ clientX: fixture.origin.clientX + 20, clientY: fixture.origin.clientY });

    expect(fixture.nativeDrag.finish).toHaveBeenCalledOnce();
    expect(fixture.nativeDrag.cancel).not.toHaveBeenCalled();
  });
});

function handleAccessorsFixture() {
  const nativeDrag = { update: vi.fn(), finish: vi.fn(), cancel: vi.fn() };
  const cssToSpreadContent = vi.fn((x: number, y: number) => ({ x, y }));
  const internals = {
    renderScale: 1,
    engines: {
      selection: {
        getHandleCarets: () => ({
          start: { x: 10, y: 20, width: 0, height: 10 },
          end: { x: 30, y: 20, width: 0, height: 10 },
          focusEdge: 'end',
        }),
        beginHandleDrag: () => nativeDrag,
      },
    },
    coordState: {
      mapper: {
        spreadContentRectToViewport: (rect: { x: number; y: number }) => rect,
        cssToSpreadContent,
      },
    },
  } as unknown as Internals;
  const canvas = {
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  } as unknown as HTMLCanvasElement;
  return {
    accessors: buildSelectionAccessors(internals, canvas),
    cssToSpreadContent,
    nativeDrag,
    origin: { clientX: 10, clientY: 25 },
  };
}
