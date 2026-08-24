import { vi, type Mock } from 'vitest';
import type { SelectionEngine } from '../../src/interaction/index';

export interface DomHarness {
  readonly target: HTMLElement;
  readonly emit: (type: string, event: unknown) => void;
}

export interface SelectionHarness {
  readonly engine: SelectionEngine;
  readonly down: Mock;
  readonly move: Mock;
  readonly up: Mock;
  readonly clear: Mock;
  readonly setState: (state: ReturnType<SelectionEngine['getState']>) => void;
}

export function createDomTarget(): DomHarness {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const captures = new Set<number>();
  const target = {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
      const current = listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
      current.add(listener);
      listeners.set(type, current);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
      listeners.get(type)?.delete(listener);
    },
    setPointerCapture(pointerId: number): void {
      captures.add(pointerId);
    },
    hasPointerCapture(pointerId: number): boolean {
      return captures.has(pointerId);
    },
    releasePointerCapture(pointerId: number): void {
      captures.delete(pointerId);
    },
  };
  return {
    target: target as unknown as HTMLElement,
    emit(type, event): void {
      for (const listener of listeners.get(type) ?? []) {
        if (typeof listener === 'function') listener(event as Event);
        else listener.handleEvent(event as Event);
      }
    },
  };
}

export function createSelectionHarness(): SelectionHarness {
  const down = vi.fn();
  const move = vi.fn();
  const up = vi.fn();
  const clear = vi.fn();
  let state: ReturnType<SelectionEngine['getState']> = 'idle';
  const engine = {
    handlePointerDown: down,
    handlePointerMove: move,
    handlePointerUp: up,
    clear,
    getState: () => state,
  } as unknown as SelectionEngine;
  return {
    engine,
    down,
    move,
    up,
    clear,
    setState: (nextState) => {
      state = nextState;
    },
  };
}

export function pointer(
  pointerId: number,
  clientX: number,
  clientY: number,
  pointerType = 'mouse',
  detail = 0,
): PointerEvent {
  return { pointerId, pointerType, button: 0, clientX, clientY, detail } as PointerEvent;
}

export function mouseDown(detail: number): MouseEvent {
  return { button: 0, detail } as MouseEvent;
}

export function pointerPosition(event: PointerEvent): { x: number; y: number } {
  return { x: event.clientX, y: event.clientY };
}

export function touch(identifier: number, clientX: number, clientY: number): Touch {
  return { identifier, clientX, clientY } as Touch;
}

export function touchEvent(
  touches: readonly Touch[],
  changedTouches: readonly Touch[],
  timeStamp = 0,
  preventDefault: Mock = vi.fn(),
): TouchEvent {
  return {
    touches: touches as unknown as TouchList,
    changedTouches: changedTouches as unknown as TouchList,
    timeStamp,
    cancelable: true,
    preventDefault,
  } as unknown as TouchEvent;
}
