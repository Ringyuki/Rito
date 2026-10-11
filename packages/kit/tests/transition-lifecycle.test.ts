import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { abortTransition, transitionLifecycle } from '../src/controller/core/transition-lifecycle';
import type { ReaderControllerEvents } from '../src/controller/types';
import { createTransitionDriver } from '../src/driver/transition-driver';
import { createEmitter } from '../src/utils/event-emitter';

function recordedEmitter() {
  const emitter = createEmitter<ReaderControllerEvents>();
  const events: string[] = [];
  emitter.on('transitionStart', ({ direction }) => events.push(`start:${direction}`));
  emitter.on('transitionProgress', ({ direction, progress }) =>
    events.push(`progress:${direction}:${String(progress)}`),
  );
  emitter.on('transitionEnd', ({ direction, outcome }) =>
    events.push(`end:${direction}:${outcome}`),
  );
  return { emitter, events };
}

describe('transition lifecycle', () => {
  it('answers every start with exactly one end', () => {
    const { emitter, events } = recordedEmitter();
    const lifecycle = transitionLifecycle(emitter);
    lifecycle.end('committed');
    lifecycle.begin('forward');
    lifecycle.begin('backward');
    lifecycle.end('cancelled');
    lifecycle.end('committed');
    expect(events).toEqual([
      'start:forward',
      'end:forward:interrupted',
      'start:backward',
      'end:backward:cancelled',
    ]);
    expect(lifecycle.openDirection).toBeNull();
  });

  it('reports progress toward the neighbour only while a turn is open', () => {
    const { emitter, events } = recordedEmitter();
    const lifecycle = transitionLifecycle(emitter);
    lifecycle.progress({ dx: -100, width: 400 });
    lifecycle.begin('forward');
    lifecycle.progress({ dx: -100, width: 400 });
    // A spring settling back past its origin is at rest, not moving away.
    lifecycle.progress({ dx: 12, width: 400 });
    lifecycle.end('cancelled');
    lifecycle.begin('backward');
    lifecycle.progress({ dx: 500, width: 400 });
    expect(events).toEqual([
      'start:forward',
      'progress:forward:0.25',
      'progress:forward:0',
      'end:forward:cancelled',
      'start:backward',
      'progress:backward:1',
    ]);
  });

  it('ends a turn in flight as interrupted when the driver is reset', () => {
    const { emitter, events } = recordedEmitter();
    const td = createTransitionDriver();
    td.viewportWidth = 800;
    td.goToTarget('forward', 0, 1);
    transitionLifecycle(emitter).begin('forward');
    td.step(16);

    abortTransition(td, emitter);

    expect(td.isAnimating).toBe(false);
    expect(events).toEqual(['start:forward', 'end:forward:interrupted']);
  });
});

describe('transition ownership', () => {
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
    });
  const controller = join(__dirname, '../src/controller');
  const offenders = (pattern: RegExp) =>
    sources(controller)
      .filter((path) => !path.endsWith('transition-lifecycle.ts'))
      .filter((path) => pattern.test(readFileSync(path, 'utf8')));

  it('emits transition events only through the lifecycle', () => {
    expect(offenders(/emit\(\s*'transition(Start|Progress|End)'/)).toEqual([]);
  });

  it('resets the transition driver only through abortTransition', () => {
    expect(offenders(/\btd\.reset\(\)/)).toEqual([]);
  });
});
