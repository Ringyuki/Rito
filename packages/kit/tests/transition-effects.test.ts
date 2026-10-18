import { describe, expect, it } from 'vitest';
import {
  springPresets,
  transitionEffects,
  type PaintedTransitionEffect,
  type TransitionFrame,
} from '../src/driver/effects';
import { createTransitionScene, paintTransition } from '../src/driver/transition-scene';
import type { PageBufferPool } from '../src/painter/buffer-pool';
import type { DisplaySurface } from '../src/painter/display-surface';
import type { QuadRect } from '../src/painter/gl/compositor';
import type { SlotPosition } from '../src/painter/types';
import { createFakeGl } from './helpers/fake-gl';
import { createTransitionDriver } from '../src/driver/transition-driver';

const W = 400;

/** A frame of a turn a finger holds, `dx` along. */
function frameAt(dx: number, incoming: 'next' | 'prev' | null): TransitionFrame {
  return { dx, width: W, incoming, phase: 'held', velocity: 0, touch: null };
}

describe('transition effects', () => {
  it('slide moves the spread and its neighbour edge to edge', () => {
    expect(transitionEffects.slide.layers(frameAt(-100, 'next'))).toEqual([
      { slot: 'curr', x: -100 },
      { slot: 'next', x: 300 },
    ]);
    // An overshoot past the origin shows the far neighbour, never a gap.
    expect(transitionEffects.slide.layers(frameAt(20, 'next'))[0]).toEqual({
      slot: 'prev',
      x: -380,
    });
  });

  it('cover slides later pages over earlier ones, shadow on the page beneath', () => {
    expect(transitionEffects.cover.layers(frameAt(-100, 'next'))).toEqual([
      { slot: 'curr', x: 0 },
      { slot: 'next', x: 300, shadow: 'left' },
    ]);
    expect(transitionEffects.cover.layers(frameAt(150, 'prev'))).toEqual([
      { slot: 'prev', x: 0 },
      { slot: 'curr', x: 150, shadow: 'left' },
    ]);
  });

  it('fade cross-fades in place by how far the turn has gone', () => {
    expect(transitionEffects.fade.layers(frameAt(-100, 'next'))).toEqual([
      { slot: 'curr', x: 0 },
      { slot: 'next', x: 0, opacity: 0.25 },
    ]);
  });

  it('every effect pulls the page against the ends of the book except none', () => {
    for (const name of ['slide', 'cover', 'fade'] as const) {
      expect(transitionEffects[name].layers(frameAt(30, null))).toEqual([{ slot: 'curr', x: 30 }]);
    }
    expect(transitionEffects.none.layers(frameAt(30, null))).toEqual([{ slot: 'curr', x: 0 }]);
  });

  it('paint the same picture once a turn that was cut into has landed', () => {
    // Which spread shows where, and how much of it: what a frame comes to on screen.
    const picture = (
      name: 'slide' | 'cover' | 'fade',
      frame: TransitionFrame,
      spreads: Record<'prev' | 'curr' | 'next', number>,
    ): { spread: number; x: number; share: number; shadow: string | undefined }[] => {
      const layers = transitionEffects[name].layers(frame);
      return layers
        .map((layer, index) => ({
          spread: spreads[layer.slot],
          x: layer.x,
          // What the layers drawn over it leave showing.
          share: layers
            .slice(index + 1)
            .reduce((left, over) => left * (1 - (over.opacity ?? 1)), layer.opacity ?? 1),
          shadow: layer.shadow,
        }))
        .filter((shown) => shown.x > -W && shown.x < W)
        .sort((a, b) => a.spread - b.spread);
    };
    for (const name of ['slide', 'cover', 'fade'] as const) {
      for (const dx of [-340, -228, -100, -12]) {
        // A turn to spread 5, and what is left of it once 5 is the current spread.
        const flying = picture(name, frameAt(dx, 'next'), { prev: 3, curr: 4, next: 5 });
        const landed = picture(name, frameAt(dx + W, 'prev'), { prev: 4, curr: 5, next: 6 });
        expect(landed).toHaveLength(flying.length);
        landed.forEach((shown, index) => {
          const before = flying[index];
          expect(shown.spread).toBe(before?.spread);
          expect(shown.x).toBeCloseTo(before?.x ?? NaN, 9);
          // Slide and cover lay whole pages side by side or over each other; a fade mixes them.
          if (name === 'fade') expect(shown.share).toBeCloseTo(before?.share ?? NaN, 9);
          expect(shown.shadow).toBe(before?.shadow);
        });
      }
    }
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
  /**
   * A display and pool that say what is drawn: each page as
   * `slot@x*opacity`, each shadow as where its edge is, how far it reaches
   * and how dark it is at the edge.
   */
  function fakeSource(painted: (slot: SlotPosition) => boolean = () => true, cssPixel = 1) {
    const calls: string[] = [];
    const shadows: { edge: number; reach: number; alpha: number }[] = [];
    const surface = {
      gl: createFakeGl().gl,
      width: W * cssPixel,
      height: 300,
      compositor: {
        bind: () => undefined,
        clear: () => undefined,
        drawTexture: () => undefined,
        drawRamp(rect: QuadRect, from: number, to: number) {
          calls.push('shadow');
          // The ramp is darkest at the sheet's edge.
          const edge = from > to ? rect.x : rect.x + rect.width;
          shadows.push({ edge, reach: rect.width, alpha: Math.max(from, to) });
        },
      },
    } as unknown as DisplaySurface;
    const slot = { spreadIndex: 0, paints: 0 };
    const pool = {
      prev: slot,
      curr: slot,
      next: slot,
      drawSlot(position: SlotPosition, rect: QuadRect, opacity = 1) {
        calls.push(`${position}@${String(rect.x)}*${String(opacity)}`);
      },
      pageTexture: (position: SlotPosition) => ({
        texture: { id: position },
        width: W * cssPixel * 2,
        height: 600,
      }),
    } as unknown as PageBufferPool;
    return { source: { surface, pool, ready: painted }, surface, calls, shadows };
  }

  it('draws a layered effect through the scene, skipping pages not painted yet', () => {
    const { source, surface, calls } = fakeSource((slot) => slot !== 'next');
    const scene = createTransitionScene(source, W, 300);
    paintTransition(scene, transitionEffects.fade, frameAt(-200, 'next'), surface);
    paintTransition(scene, transitionEffects.cover, frameAt(100, 'prev'), surface);
    expect(calls).toEqual(['curr@0*1', 'prev@0*1', 'shadow', 'curr@100*1']);
  });

  it('a sheet leaving the frame takes its shadow with it', () => {
    // The shadow a cover frame at `dx` paints.
    const shadow = (dx: number, incoming: 'next' | 'prev', cssPixel = 1) => {
      const { source, surface, shadows } = fakeSource(() => true, cssPixel);
      const scene = createTransitionScene(source, W * cssPixel, 300, cssPixel);
      const frame = { ...frameAt(dx * cssPixel, incoming), width: W * cssPixel };
      paintTransition(scene, transitionEffects.cover, frame, surface);
      return shadows[0] ?? null;
    };

    // The shadow is black at 0.18, an alpha a colour keeps as a byte.
    const full = Math.round(0.18 * 255) / 255;
    // Turning back, this page slides off to the right over the one before.
    expect(shadow(150, 'prev')).toEqual({ edge: 150, reach: 24, alpha: full });
    expect(shadow(W - 24, 'prev')?.alpha).toBe(full);
    expect(shadow(W - 12, 'prev')?.alpha).toBeCloseTo(0.09);
    expect(shadow(W - 6, 'prev')?.alpha).toBeCloseTo(0.045);
    expect(shadow(W, 'prev')).toBeNull();
    // Turning forward, the next page casts none before it is in the frame,
    // and its shadow leaves the frame ahead of it as it arrives.
    expect(shadow(0, 'next')).toBeNull();
    expect(shadow(-12, 'next')?.alpha).toBeCloseTo(0.09);
    expect(shadow(-W, 'next')).toEqual({ edge: 0, reach: 24, alpha: full });
    // The reach is a length on the page, whatever the display's density.
    expect(shadow(150, 'prev', 3)).toEqual({ edge: 450, reach: 72, alpha: full });
    expect(shadow(W - 12, 'prev', 3)?.alpha).toBeCloseTo(0.09);
  });

  it('hands a painted effect the scene, its pages and the frame', () => {
    const { source, surface, calls } = fakeSource();
    const seen: string[] = [];
    const curl: PaintedTransitionEffect = {
      paint(scene, frame) {
        seen.push(`${String(scene.page('curr')?.pixelRatio)}:${String(frame.dx)}`);
        expect(scene.gl).toBe(surface.gl);
        scene.drawPage('next', frame.width + frame.dx, 0.5);
      },
    };
    const scene = createTransitionScene(source, W, 300);
    paintTransition(scene, curl, frameAt(-100, 'next'), surface);
    expect(seen).toEqual(['2:-100']);
    expect(calls).toEqual(['next@300*0.5']);
  });
});
