import { describe, expect, it, vi } from 'vitest';
import type { TransitionFrame, TransitionPage, TransitionScene } from '../src/driver/effects';
import type { Gl } from '../src/driver/paper/gl';
import type { StartedGpu } from '../src/driver/paper/gpu';
import { paperTurnWith } from '../src/driver/paper/paper-turn';
import { createPaperRenderer, type PaperRenderer } from '../src/driver/paper/renderer';
import { sheetFragment, sheetVertex } from '../src/driver/paper/shaders';
import { createTransitionDriver } from '../src/driver/transition-driver';

/** A GPU that says when asked whether it has finished compiling, and records what it is asked. */
function compiling() {
  const state = { done: false };
  const asked: unknown[] = [];
  const answers: Record<string, unknown> = {
    LINK_STATUS: 'linked?',
    getExtension: (name: string) =>
      name === 'KHR_parallel_shader_compile' ? { COMPLETION_STATUS_KHR: 'finished?' } : null,
    getProgramParameter: (_program: unknown, what: unknown) => {
      asked.push(what);
      return what === 'finished?' ? state.done : true;
    },
    isContextLost: () => false,
    canvas: { addEventListener: () => undefined },
  };
  // Everything else it is told to do, it does without a word.
  const gl = new Proxy(answers, {
    get: (target, name: string) => (name in target ? target[name] : () => ({})),
  }) as unknown as Gl;
  const program = { program: {}, shaders: [], attributes: [], uniforms: [] };
  const started: StartedGpu = {
    gl,
    softened: false,
    samples: 4,
    sheet: program,
    shadow: { cast: program, cover: program, occlusion: program, blur: program, lay: program },
  };
  return { state, asked, started };
}

describe('a paper turn readied ahead of its first frame', () => {
  it('hands the GPU its programs once and does not wait for them', () => {
    const gpu = compiling();
    const make = vi.fn((_gl: Gl) => gpu.started);
    const renderer = createPaperRenderer(make);
    renderer.prepare(gpu.started.gl);
    renderer.prepare(gpu.started.gl);
    expect(make).toHaveBeenCalledOnce();
    expect(make.mock.calls[0]?.[0]).toBe(gpu.started.gl);
    // Nothing has been asked that would make the page wait for the GPU.
    expect(gpu.asked).toEqual([]);

    expect(renderer.standing).toBe('waiting');
    expect(gpu.asked).not.toContain('linked?');
    gpu.state.done = true;
    expect(renderer.standing).toBe('ready');
    expect(renderer.epoch).toBe(1);
    expect(make).toHaveBeenCalledOnce();
  });

  it('says there is no GPU where none is to be had', () => {
    const renderer = createPaperRenderer(() => null);
    renderer.prepare(compiling().started.gl);
    expect(renderer.standing).toBe('none');
    expect(renderer.draw({} as Parameters<PaperRenderer['draw']>[0])).toBe(false);
  });

  it('is told it has been set, by the driver, at once and again when it is set again', () => {
    const prepare = vi.fn();
    const effect = { paint: vi.fn(), prepare };
    const gl = compiling().started.gl;
    const td = createTransitionDriver({ effect }, gl);
    expect(prepare).toHaveBeenCalledOnce();
    expect(prepare.mock.calls[0]?.[0]).toBe(gl);
    td.configure({ stiffness: 200 });
    expect(prepare).toHaveBeenCalledOnce();
    td.configure({ effect });
    expect(prepare).toHaveBeenCalledTimes(2);
    // A built-in effect has nothing to ready.
    td.configure({ effect: 'cover' });
    expect(prepare).toHaveBeenCalledTimes(2);
  });
});

describe('a paper turn begun before the GPU is ready', () => {
  function staged() {
    let standing: PaperRenderer['standing'] = 'waiting';
    const drawn: string[] = [];
    const prepared = vi.fn();
    const renderer: PaperRenderer = {
      epoch: 1,
      get standing() {
        return standing;
      },
      prepare: prepared,
      snapshot: () => null,
      release: () => undefined,
      draw: () => {
        drawn.push('leaf');
        return true;
      },
    };
    const clock = { now: 0 };
    const effect = paperTurnWith(renderer, { now: () => clock.now });
    const page = (spread: number): TransitionPage => ({
      spread,
      texture: { spread } as unknown as WebGLTexture,
      width: 400,
      height: 600,
      pixelRatio: 1,
      version: 0,
    });
    /** The scene with `current` as the spread on screen. */
    const scene = (current: number): TransitionScene => ({
      gl: compiling().started.gl as unknown as WebGL2RenderingContext,
      width: 400,
      height: 600,
      cssPixel: 1,
      spine: 200,
      page: (slot) => page(current + ['prev', 'curr', 'next'].indexOf(slot) - 1),
      drawPage: (slot) => drawn.push(`plain:${slot}`),
    });
    const frame = (dx: number): TransitionFrame => ({
      dx,
      width: 400,
      incoming: 'next',
      phase: 'landing',
      velocity: 0,
      touch: null,
    });
    const paint = (current: number, dx: number): string[] => {
      drawn.length = 0;
      clock.now += 16;
      effect.paint(scene(current), frame(dx));
      return [...drawn];
    };
    return { effect, prepared, paint, ready: () => (standing = 'ready') };
  }

  it('readies its renderer when it is set', () => {
    const { effect, prepared } = staged();
    const gl = compiling().started.gl;
    effect.prepare?.(gl);
    expect(prepared).toHaveBeenCalledOnce();
    expect(prepared.mock.calls[0]?.[0]).toBe(gl);
  });

  it('is drawn plain to its end, said once, and holds no turn up; the next is a leaf', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { paint, ready } = staged();
    expect(paint(4, -40)).toEqual(['plain:curr', 'plain:next']);
    // The GPU finishes halfway: a leaf appearing now would be a jump.
    ready();
    expect(paint(4, -200)).toEqual(['plain:curr', 'plain:next']);
    expect(paint(4, -390)).toEqual(['plain:curr', 'plain:next']);
    // The turn after it, cut in or not, is drawn as a leaf.
    expect(paint(5, -40)).toEqual(['leaf']);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('the sheet shader', () => {
  it('softens an edge only where the canvas is not multisampled, in the dialect the GPU takes', () => {
    expect(sheetFragment(false, false)).not.toContain('fwidth');
    expect(sheetFragment(false, false)).not.toContain('#version');
    // The first generation of WebGL asks for the extension; the second has it.
    const first = sheetFragment(true, false);
    expect(first).toContain('fwidth');
    expect(first.startsWith('#extension GL_OES_standard_derivatives : enable')).toBe(true);
    const second = sheetFragment(true, true);
    expect(second.startsWith('#version 300 es')).toBe(true);
    expect(second).not.toContain('#extension');
    expect(sheetVertex(true).startsWith('#version 300 es')).toBe(true);
    expect(sheetVertex(false)).not.toContain('#version');
  });
});
