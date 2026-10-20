/**
 * How a finger turns a page, frame by frame, the same in @ritojs/kit and
 * rito_flutter: each scenario's touches and frame times, and what the turn
 * draws at every frame and how each turn ends, as the kit makes them
 * (`fixtures/turn-gestures.json`). This suite holds the kit to the file;
 * rito_flutter's replays the touches through its own recognizer and
 * controller and holds itself to it. `RITO_EMIT_TURN_GESTURES=1` writes it.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PaperTurnModel } from '@ritojs/core';
import { describe, expect, it } from 'vitest';
import { paperPhysics } from '../src/driver/paper/paper-physics';
import type { DrawInstruction } from '../src/driver/types';
import { touch, touchEvent } from './helpers/dom-input';
import { engineBuilt, paperTurnModel } from './helpers/engine';
import { createTouchNavigationScenario as createScenario } from './helpers/touch-navigation';

const FIXTURE = join(import.meta.dirname, 'fixtures/turn-gestures.json');
/** The same scenarios moved by the paper turn's physics, the engine's model. */
const PAPER_FIXTURE = join(import.meta.dirname, 'fixtures/turn-gestures-paper.json');
const emitting = process.env['RITO_EMIT_TURN_GESTURES'] === '1';

/** The page width a turn crosses, px. */
const WIDTH = 300;

/** A touch, or a key turning to the next or previous page (at 0, 0). */
type Touch = readonly ['down' | 'move' | 'up' | 'next' | 'prev', number, number, number];

interface Scenario {
  readonly name: string;
  /** Milliseconds between frames. */
  readonly frame: number;
  /** Frames are drawn up to this time, ms. */
  readonly until: number;
  /** Each touch or key: what, when (ms), where (x, y). */
  readonly touches: readonly Touch[];
}

interface Drawn {
  readonly dx: number;
  readonly phase: string;
  readonly incoming: string | null;
  readonly velocity: number;
}

interface Recorded extends Scenario {
  /** What the turn draws at each frame; null when no turn is drawn. */
  readonly frames: readonly (Drawn | null)[];
  readonly starts: readonly string[];
  readonly ends: readonly string[];
}

/** A finger moving from `from` to `to` in `steps` touches `every` ms apart, starting at `at`. */
function stroke(
  at: number,
  from: readonly [number, number],
  to: readonly [number, number],
  steps: number,
  every: number,
): Touch[] {
  const touches: Touch[] = [];
  for (let i = 1; i <= steps; i += 1) {
    const x = from[0] + ((to[0] - from[0]) * i) / steps;
    const y = from[1] + ((to[1] - from[1]) * i) / steps;
    touches.push(['move', at + i * every, x, y]);
  }
  return touches;
}

const SCENARIOS: readonly Scenario[] = [
  {
    name: 'flick-forward',
    frame: 8,
    until: 1200,
    touches: [
      ['down', 0, 250, 300],
      ...stroke(0, [250, 300], [190, 302], 6, 8),
      ['up', 52, 190, 302],
    ],
  },
  {
    name: 'drag-past-half-and-let-go',
    frame: 16,
    until: 1600,
    touches: [
      ['down', 0, 280, 300],
      ...stroke(0, [280, 300], [100, 310], 18, 16),
      ['up', 400, 100, 310],
    ],
  },
  {
    name: 'drag-a-little-and-let-go',
    frame: 16,
    until: 1200,
    touches: [
      ['down', 0, 250, 300],
      ...stroke(0, [250, 300], [225, 300], 10, 24),
      ['up', 300, 225, 300],
    ],
  },
  {
    name: 'flick-back',
    frame: 8,
    until: 1200,
    touches: [
      ['down', 0, 40, 300],
      ...stroke(0, [40, 300], [110, 296], 5, 8),
      ['up', 44, 110, 296],
    ],
  },
  {
    name: 'slide-up-then-across',
    frame: 8,
    until: 1300,
    touches: [
      ['down', 0, 250, 500],
      ...stroke(0, [250, 500], [252, 400], 8, 8),
      ...stroke(64, [252, 400], [150, 396], 8, 8),
      ['up', 132, 150, 396],
    ],
  },
  {
    name: 'finger-during-turn',
    frame: 8,
    until: 1400,
    touches: [
      ['down', 0, 250, 300],
      ...stroke(0, [250, 300], [190, 300], 5, 8),
      ['up', 44, 190, 300],
      ['down', 120, 260, 320],
      ...stroke(120, [260, 320], [170, 320], 9, 8),
      ['up', 200, 170, 320],
    ],
  },
  {
    name: 'key-next',
    frame: 16,
    until: 1000,
    touches: [['next', 0, 0, 0]],
  },
  {
    name: 'key-back-during-turn',
    frame: 8,
    until: 1200,
    touches: [
      ['next', 0, 0, 0],
      ['prev', 96, 0, 0],
    ],
  },
];

function drawnOf(instruction: DrawInstruction): Drawn | null {
  if (instruction.kind !== 'turning') return null;
  return {
    dx: instruction.dx,
    phase: instruction.phase,
    incoming: instruction.incoming,
    velocity: instruction.velocity,
  };
}

/** Read through a call: a step changes it. */
function animating(td: { readonly isAnimating: boolean }): boolean {
  return td.isAnimating;
}

/**
 * Plays a scenario through the kit's touch handler and transition driver,
 * frames drawn as the frame driver draws them: while a turn is on screen,
 * each step as long as the time since the last, at most 32 ms, the first
 * after a rest 16 ms. With `model`, the turn moves by the paper turn's
 * physics, its clock the time of the touch or frame at hand.
 */
function play(scenario: Scenario, model?: PaperTurnModel): Recorded {
  const s = createScenario(true, 5);
  s.internals.currentSpread = 2;
  s.td.viewportWidth = WIDTH;
  let clock = 0;
  if (model) s.td.configure({ physics: paperPhysics(model, () => clock) });
  const starts: string[] = [];
  const ends: string[] = [];
  s.transitionStart.mockImplementation((event: { direction: string }) => {
    starts.push(event.direction);
  });
  s.transitionEnd.mockImplementation((event: { outcome: string }) => {
    ends.push(event.outcome);
  });
  const frames: (Drawn | null)[] = [];
  let next = 0;
  let last = 0;
  for (let at = scenario.frame; at <= scenario.until; at += scenario.frame) {
    while (next < scenario.touches.length && (scenario.touches[next]?.[1] ?? Infinity) <= at) {
      const [what, when, x, y] = scenario.touches[next] ?? ['up', 0, 0, 0];
      clock = when;
      const finger = touch(1, x, y);
      if (what === 'down') s.dom.emit('touchstart', touchEvent([finger], [finger], when));
      if (what === 'move') s.dom.emit('touchmove', touchEvent([finger], [finger], when));
      if (what === 'up') s.dom.emit('touchend', touchEvent([], [finger], when));
      if (what === 'next') s.nav.nextSpread();
      if (what === 'prev') s.nav.prevSpread();
      next += 1;
    }
    clock = at;
    if (!s.td.isAnimating) {
      last = 0;
      frames.push(null);
      continue;
    }
    const drawn = s.td.step(last > 0 ? Math.min(at - last, 32) : 16);
    // A step that brings the turn to rest stops the loop: the next starts afresh.
    last = animating(s.td) ? at : 0;
    frames.push(drawnOf(drawn));
  }
  const played = { ...scenario, frames, starts: [...starts], ends: [...ends] };
  s.disposables.disposeAll();
  return played;
}

const NOTE =
  'How a finger turns a page, frame by frame, the same in @ritojs/kit and rito_flutter: each scenario plays its touches (what, ms, x, y in the view; `next` and `prev` are keys) with a frame every `frame` ms up to `until`, the page `width` px wide and neighbours both ways; `frames` is what the turn draws at each frame (null for none), `starts` and `ends` each turn it starts and how it ends. Written by packages/kit/tests/turn-gestures.test.ts (RITO_EMIT_TURN_GESTURES=1).';

/** Holds what `recorded` says to `file`, or writes it there. */
function heldTo(file: string, physics: string, scenarios: readonly Recorded[]): void {
  const recorded = { note: NOTE, physics, width: WIDTH, scenarios };
  const text = `${JSON.stringify(recorded, null, 1)}\n`;
  if (emitting) writeFileSync(file, text);
  expect(existsSync(file), 'the fixture is missing; emit it').toBe(true);
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(JSON.parse(text));
}

describe('a finger turning pages, frame by frame', () => {
  it('draws what the fixture every host is held to says', () => {
    heldTo(
      FIXTURE,
      'built-in',
      SCENARIOS.map((scenario) => play(scenario)),
    );
  });

  it.skipIf(!engineBuilt)('draws it as the paper turn moves it, too', async () => {
    const model = await paperTurnModel();
    heldTo(
      PAPER_FIXTURE,
      'paper',
      SCENARIOS.map((scenario) => play(scenario, model)),
    );
  });

  it('turns the pages each scenario means to turn', () => {
    const ends = Object.fromEntries(
      SCENARIOS.map((scenario) => [scenario.name, play(scenario)] as const),
    );
    // Every scenario plays until its turns are at rest.
    for (const played of Object.values(ends)) expect(played.frames.at(-1)).toBeNull();
    expect(ends['flick-forward']?.ends).toEqual(['committed']);
    expect(ends['drag-past-half-and-let-go']?.ends).toEqual(['committed']);
    expect(ends['drag-a-little-and-let-go']?.ends).toEqual(['cancelled']);
    expect(ends['flick-back']?.starts).toEqual(['backward']);
    expect(ends['flick-back']?.ends).toEqual(['committed']);
    expect(ends['slide-up-then-across']?.ends).toEqual(['committed']);
    expect(ends['finger-during-turn']?.ends).toEqual(['committed', 'committed']);
    expect(ends['key-next']?.ends).toEqual(['committed']);
    expect(ends['key-back-during-turn']?.starts).toEqual(['forward', 'backward']);
    expect(ends['key-back-during-turn']?.ends).toEqual(['committed', 'committed']);
  });
});
