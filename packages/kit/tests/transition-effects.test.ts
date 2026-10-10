import { describe, expect, it } from 'vitest';
import {
  springPresets,
  transitionEffects,
  type PaintedTransitionEffect,
  type TransitionPage,
} from '../src/driver/effects';
import { createTransitionScene, paintTransition } from '../src/driver/transition-scene';
import { createTransitionDriver } from '../src/driver/transition-driver';

const W = 400;

describe('transition effects', () => {
  it('slide moves the spread and its neighbour edge to edge', () => {
    expect(transitionEffects.slide.layers({ dx: -100, width: W, incoming: 'next' })).toEqual([
      { slot: 'curr', x: -100 },
      { slot: 'next', x: 300 },
    ]);
    // An overshoot past the origin shows the far neighbour, never a gap.
    expect(transitionEffects.slide.layers({ dx: 20, width: W, incoming: 'next' })[0]).toEqual({
      slot: 'prev',
      x: -380,
    });
  });

  it('cover slides later pages over earlier ones, shadow on the page beneath', () => {
    expect(transitionEffects.cover.layers({ dx: -100, width: W, incoming: 'next' })).toEqual([
      { slot: 'curr', x: 0 },
      { slot: 'next', x: 300, shadow: 'left' },
    ]);
    expect(transitionEffects.cover.layers({ dx: 150, width: W, incoming: 'prev' })).toEqual([
      { slot: 'prev', x: 0 },
      { slot: 'curr', x: 150, shadow: 'left' },
    ]);
  });

  it('fade cross-fades in place by how far the turn has gone', () => {
    expect(transitionEffects.fade.layers({ dx: -100, width: W, incoming: 'next' })).toEqual([
      { slot: 'curr', x: 0 },
      { slot: 'next', x: 0, opacity: 0.25 },
    ]);
  });

  it('every effect pulls the page against the ends of the book except none', () => {
    for (const name of ['slide', 'cover', 'fade'] as const) {
      expect(transitionEffects[name].layers({ dx: 30, width: W, incoming: null })).toEqual([
        { slot: 'curr', x: 30 },
      ]);
    }
    expect(transitionEffects.none.layers({ dx: 30, width: W, incoming: null })).toEqual([
      { slot: 'curr', x: 0 },
    ]);
  });

  it('an instant effect lands a turn on its first frame', () => {
    const td = createTransitionDriver({ effect: 'none' });
    td.viewportWidth = W;
    const settled: number[] = [];
    td.onSettled(({ targetSpread }) => settled.push(targetSpread));
    td.goToTarget('forward', 2, 3);
    td.step(16);
    expect(td.isAnimating).toBe(false);
    expect(settled).toEqual([3]);
  });

  it('reduced motion turns any effect into a cross-fade unless the host opts out', () => {
    const td = createTransitionDriver({ effect: 'cover' });
    expect(td.effect).toBe(transitionEffects.cover);
    td.reducedMotion = true;
    expect(td.effect).toBe(transitionEffects.fade);
    td.configure({ respectReducedMotion: false });
    expect(td.effect).toBe(transitionEffects.cover);
  });

  it('spring presets are critically damped or close to it', () => {
    for (const { stiffness, damping } of Object.values(springPresets)) {
      const ratio = damping / (2 * Math.sqrt(stiffness));
      expect(ratio).toBeGreaterThan(0.75);
      expect(ratio).toBeLessThanOrEqual(1.01);
    }
  });
});

describe('transition scene', () => {
  function fakeContext() {
    const calls: string[] = [];
    const context = {
      globalAlpha: 1,
      fillStyle: '',
      drawImage(image: { id: string }, x: number) {
        calls.push(`${image.id}@${String(x)}*${String(this.globalAlpha)}`);
      },
      createLinearGradient: () => ({ addColorStop: () => undefined }),
      fillRect: () => calls.push('shadow'),
    };
    return { context: context as unknown as CanvasRenderingContext2D, calls };
  }
  const page = (id: string): TransitionPage => ({
    content: { id } as unknown as CanvasImageSource,
    overlay: null,
    pixelRatio: 2,
  });

  it('draws a layered effect through the scene, skipping pages not painted yet', () => {
    const { context, calls } = fakeContext();
    const scene = createTransitionScene(context, W, 300, (slot) =>
      slot === 'next' ? null : page(slot),
    );
    paintTransition(scene, transitionEffects.fade, { dx: -200, width: W, incoming: 'next' });
    paintTransition(scene, transitionEffects.cover, { dx: 100, width: W, incoming: 'prev' });
    expect(calls).toEqual(['curr@0*1', 'prev@0*1', 'shadow', 'curr@100*1']);
  });

  it('a sheet leaving the frame takes its shadow with it', () => {
    // The shadow a cover frame at `dx` paints: where its edge is, how far
    // it reaches and how dark it is at the edge.
    const shadow = (dx: number, incoming: 'next' | 'prev', cssPixel = 1) => {
      const shadows: { edge: number; reach: number; alpha: number }[] = [];
      let stops: string[] = [];
      const context = {
        globalAlpha: 1,
        fillStyle: '',
        drawImage: () => undefined,
        createLinearGradient: (edge: number, _y: number, to: number) => {
          stops = [];
          shadows.push({ edge, reach: Math.abs(to - edge), alpha: 0 });
          return { addColorStop: (_at: number, color: string) => stops.push(color) };
        },
        fillRect: () => {
          const alpha = /, ([\d.]+)\)$/.exec(stops[0] ?? '');
          const last = shadows.at(-1);
          if (last) last.alpha = Number(alpha?.[1]);
        },
      } as unknown as CanvasRenderingContext2D;
      const scene = createTransitionScene(context, W * cssPixel, 300, page, cssPixel);
      const frame = { dx: dx * cssPixel, width: W * cssPixel, incoming };
      paintTransition(scene, transitionEffects.cover, frame);
      return shadows[0] ?? null;
    };

    // Turning back, this page slides off to the right over the one before.
    expect(shadow(150, 'prev')).toEqual({ edge: 150, reach: 24, alpha: 0.18 });
    expect(shadow(W - 24, 'prev')?.alpha).toBe(0.18);
    expect(shadow(W - 12, 'prev')?.alpha).toBeCloseTo(0.09);
    expect(shadow(W - 6, 'prev')?.alpha).toBeCloseTo(0.045);
    expect(shadow(W, 'prev')).toBeNull();
    // Turning forward, the next page casts none before it is in the frame,
    // and its shadow leaves the frame ahead of it as it arrives.
    expect(shadow(0, 'next')).toBeNull();
    expect(shadow(-12, 'next')?.alpha).toBeCloseTo(0.09);
    expect(shadow(-W, 'next')).toEqual({ edge: 0, reach: 24, alpha: 0.18 });
    // The reach is a length on the page, whatever the display's density.
    expect(shadow(150, 'prev', 3)).toEqual({ edge: 450, reach: 72, alpha: 0.18 });
    expect(shadow(W - 12, 'prev', 3)?.alpha).toBeCloseTo(0.09);
  });

  it('hands a painted effect the scene, its pages and the frame', () => {
    const { context, calls } = fakeContext();
    const seen: string[] = [];
    const curl: PaintedTransitionEffect = {
      paint(scene, frame) {
        seen.push(`${String(scene.page('curr')?.pixelRatio)}:${String(frame.dx)}`);
        scene.drawPage('next', frame.width + frame.dx, 0.5);
      },
    };
    const scene = createTransitionScene(context, W, 300, page);
    paintTransition(scene, curl, { dx: -100, width: W, incoming: 'next' });
    expect(seen).toEqual(['2:-100']);
    expect(calls).toEqual(['next@300*0.5']);
  });
});
