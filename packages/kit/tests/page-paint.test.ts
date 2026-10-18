import type { Reader } from '@ritojs/core';
import { describe, expect, it, vi } from 'vitest';
import type { Internals } from '../src/controller/facade';
import { paintPagesOver, type PagePaint, type PagePainter } from '../src/controller/page-paint';
import { createContentRenderer } from '../src/controller/runtime-frame';
import type { PageTarget } from '../src/painter/buffer-pool';
import type { ReaderControllerEvents } from '../src/controller/types';
import { createEmitter } from '../src/utils/event-emitter';

describe('page painter', () => {
  it('draws on each page of the spread, at its corner, at the backing ratio', () => {
    const { context, drawn } = recordingContext();
    const painter = recordingPainter(drawn);

    paintPagesOver(painter, 0, context, reader('book'), 1.5, rethrow);

    // dpr 2 × renderScale 1.5; the right page starts past the left one and the gap.
    expect(drawn).toEqual([
      { transform: [3, 0, 0, 3, 0, 0], clip: [0, 0, 400, 600], page: page(10, 'left', 120) },
      {
        transform: [3, 0, 0, 3, 1260, 0],
        clip: [0, 0, 400, 600],
        page: page(11, 'right', 120),
      },
    ]);
    expect(context.save).toHaveBeenCalledTimes(2);
    expect(context.restore).toHaveBeenCalledTimes(2);
  });

  it('gives no book page number while only the chapter is laid out', () => {
    const { context, drawn } = recordingContext();

    paintPagesOver(recordingPainter(drawn), 0, context, reader('chapter'), 1, rethrow);

    expect(drawn.map((entry) => entry.page)).toEqual([
      page(10, 'left', null),
      page(11, 'right', null),
    ]);
  });

  it('keeps painting the other pages past a painter that throws, and restores the context', () => {
    const { context, drawn } = recordingContext();
    const failure = new Error('host painter failed');
    const errors: unknown[] = [];
    const painter: PagePainter = (target, info) => {
      if (info.side === 'left') throw failure;
      recordingPainter(drawn)(target, info);
    };

    paintPagesOver(painter, 0, context, reader('book'), 1, (error) => errors.push(error));

    expect(errors).toEqual([failure]);
    expect(drawn.map((entry) => entry.page.pageIndex)).toEqual([11]);
    expect(context.restore).toHaveBeenCalledTimes(2);
  });

  it('runs after the engine paints a spread, never over one it could not paint', () => {
    const { context, drawn } = recordingContext();
    const painted = { value: true };
    const renderer = createContentRenderer(
      { ...reader('book'), renderSpreadTo: () => painted.value } as unknown as Reader,
      internals(recordingPainter(drawn)),
      createEmitter<ReaderControllerEvents>(),
    );

    const page = pageOver(context);
    expect(renderer(0, page)).toBe(true);
    expect(drawn).toHaveLength(2);
    painted.value = false;
    expect(renderer(0, page)).toBe(false);
    expect(drawn).toHaveLength(2);
  });

  it('reports a painter fault and shows the page, even past a throwing error listener', () => {
    const { context } = recordingContext();
    const emitter = createEmitter<ReaderControllerEvents>();
    const errors: ReaderControllerEvents['error'][] = [];
    emitter.on('error', (event) => {
      errors.push(event);
      throw new Error('listener failed');
    });
    const renderer = createContentRenderer(
      { ...reader('book'), renderSpreadTo: () => true } as unknown as Reader,
      internals(() => {
        throw new Error('host painter failed');
      }),
      emitter,
    );

    expect(renderer(0, pageOver(context))).toBe(true);
    expect(errors).toEqual([
      { message: 'host painter failed', source: 'page-painter' },
      { message: 'host painter failed', source: 'page-painter' },
    ]);
  });
});

interface Drawn {
  readonly transform: readonly number[];
  readonly clip: readonly number[];
  readonly page: PagePaint;
}

function rethrow(error: unknown): never {
  throw error;
}

function page(pageIndex: number, side: 'left' | 'right', count: number | null): PagePaint {
  return {
    pageIndex,
    bookPageIndex: count === null ? null : pageIndex,
    bookPageCount: count,
    side,
    width: 400,
    height: 600,
    margins: { top: 40, right: 30, bottom: 50, left: 30 },
  };
}

function reader(layoutScope: 'chapter' | 'book') {
  return {
    layoutScope,
    pageCount: 120,
    dpr: 2,
    spreads: [{ index: 0, pageIndexes: [10, 11], leftPageIndex: 10, rightPageIndex: 11 }],
    getLayoutGeometry: () => ({
      viewportWidth: 820,
      viewportHeight: 600,
      pageWidth: 400,
      pageHeight: 600,
      marginTop: 40,
      marginRight: 30,
      marginBottom: 50,
      marginLeft: 30,
      spreadGap: 20,
      spreadMode: 'double',
    }),
  } as unknown as Reader;
}

function internals(paintPage: PagePainter): Internals {
  return { options: { paintPage }, renderScale: 1 } as unknown as Internals;
}

/** A page target whose host layer is `context`. */
function pageOver(context: OffscreenCanvasRenderingContext2D): PageTarget {
  return {
    target: { gl: {} as WebGL2RenderingContext, framebuffer: null, width: 1, height: 1 },
    hostLayer: () => context,
  };
}

/** A context that remembers the transform and clip in force when the painter runs. */
function recordingContext() {
  const drawn: Drawn[] = [];
  let transform: number[] = [1, 0, 0, 1, 0, 0];
  let clip: number[] = [];
  const stack: { transform: number[]; clip: number[] }[] = [];
  const context = {
    save: vi.fn(() => stack.push({ transform, clip })),
    restore: vi.fn(() => {
      const top = stack.pop();
      if (top) ({ transform, clip } = top);
    }),
    setTransform: (...values: number[]) => {
      transform = values;
    },
    beginPath: () => undefined,
    rect: (...values: number[]) => {
      clip = values;
    },
    clip: () => undefined,
    current: () => ({ transform, clip }),
  };
  return {
    context: context as unknown as OffscreenCanvasRenderingContext2D & typeof context,
    drawn,
  };
}

function recordingPainter(drawn: Drawn[]): PagePainter {
  return (context, info) => {
    const state = (context as unknown as { current: () => Omit<Drawn, 'page'> }).current();
    drawn.push({ ...state, page: info });
  };
}
