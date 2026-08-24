import { describe, expect, it, vi } from 'vitest';
import { createCoordinatorState } from '../src/controller/core/coordinator-state';
import type { WiringDeps } from '../src/controller/core/wiring-deps';
import { wireDomHelpers } from '../src/controller/wiring/dom';
import { createDisposableCollection } from '../src/utils/disposable';

describe('annotation DOM hover', () => {
  it('does not repeatedly emit an empty hover while no annotation is hit', () => {
    const listeners = new Map<string, Set<EventListener>>();
    const canvas = createCanvas(listeners);
    const emit = vi.fn();
    const deps = {
      canvas,
      coordState: createCoordinatorState(),
      reader: {},
      emitter: { emit },
      engines: {
        selection: {
          clear: vi.fn(),
          getText: () => '',
          handlePointerDown: vi.fn(),
          handlePointerMove: vi.fn(),
          handlePointerUp: vi.fn(),
        },
      },
    } as unknown as WiringDeps;
    const disposables = createDisposableCollection();
    wireDomHelpers(deps, disposables);

    dispatch(listeners, 'pointermove');
    dispatch(listeners, 'pointermove');

    expect(emit).not.toHaveBeenCalledWith('annotationHover', expect.anything());
    disposables.disposeAll();
  });
});

function createCanvas(listeners: Map<string, Set<EventListener>>): HTMLCanvasElement {
  return {
    style: {},
    addEventListener(type: string, listener: EventListener) {
      const values = listeners.get(type) ?? new Set<EventListener>();
      values.add(listener);
      listeners.set(type, values);
    },
    removeEventListener(type: string, listener: EventListener) {
      listeners.get(type)?.delete(listener);
    },
    setAttribute: vi.fn(),
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  } as unknown as HTMLCanvasElement;
}

function dispatch(listeners: ReadonlyMap<string, ReadonlySet<EventListener>>, type: string): void {
  const event = { clientX: 10, clientY: 10, pointerId: 1, pointerType: 'mouse' } as PointerEvent;
  for (const listener of listeners.get(type) ?? []) listener(event);
}
