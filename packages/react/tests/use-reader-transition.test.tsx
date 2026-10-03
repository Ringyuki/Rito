// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ReaderController, ReaderControllerEvents } from '@ritojs/kit';
import {
  useReaderTransition,
  useReaderTransitionProgress,
  type ReaderTransitionState,
} from '../src/hooks/use-reader-transition';

describe('useReaderTransition', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('follows the controller from a turn start to its end and resets with a new controller', () => {
    const first = controllerStub();
    const second = controllerStub();
    let latest: ReaderTransitionState | undefined;
    const render = (controller: ReaderController) => {
      act(() => {
        root.render(
          <Harness
            controller={controller}
            onValue={(value) => {
              latest = value;
            }}
          />,
        );
      });
    };

    render(first.controller);
    expect(latest).toEqual({ isTransitioning: false, direction: null });
    act(() => {
      first.emit('transitionStart', { direction: 'backward' });
    });
    expect(latest).toEqual({ isTransitioning: true, direction: 'backward' });
    act(() => {
      first.emit('transitionEnd', { direction: 'backward', outcome: 'interrupted' });
    });
    expect(latest).toEqual({ isTransitioning: false, direction: null });

    act(() => {
      first.emit('transitionStart', { direction: 'forward' });
    });
    render(second.controller);
    expect(latest).toEqual({ isTransitioning: false, direction: null });
  });
});

describe('useReaderTransitionProgress', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('follows painted frames and drops to 0 when the turn ends', () => {
    const stub = controllerStub();
    let latest = -1;
    act(() => {
      root.render(
        <ProgressHarness
          controller={stub.controller}
          onValue={(value) => {
            latest = value;
          }}
        />,
      );
    });
    expect(latest).toBe(0);
    act(() => {
      stub.emit('transitionStart', { direction: 'forward' });
      stub.emit('transitionProgress', { direction: 'forward', progress: 0.4 });
    });
    expect(latest).toBe(0.4);
    act(() => {
      stub.emit('transitionEnd', { direction: 'forward', outcome: 'committed' });
    });
    expect(latest).toBe(0);
  });
});

function ProgressHarness({
  controller,
  onValue,
}: {
  readonly controller: ReaderController;
  readonly onValue: (value: number) => void;
}) {
  onValue(useReaderTransitionProgress(controller));
  return null;
}

function Harness({
  controller,
  onValue,
}: {
  readonly controller: ReaderController;
  readonly onValue: (value: ReaderTransitionState) => void;
}) {
  onValue(useReaderTransition(controller));
  return null;
}

function controllerStub(): {
  readonly controller: ReaderController;
  emit<K extends keyof ReaderControllerEvents>(event: K, value: ReaderControllerEvents[K]): void;
} {
  const listeners = new Map<keyof ReaderControllerEvents, Set<(value: never) => void>>();
  const controller = {
    on(event: keyof ReaderControllerEvents, listener: (value: never) => void) {
      const current = listeners.get(event) ?? new Set();
      current.add(listener);
      listeners.set(event, current);
      return () => current.delete(listener);
    },
  } as unknown as ReaderController;
  return {
    controller,
    emit(event, value) {
      for (const listener of listeners.get(event) ?? []) listener(value as never);
    },
  };
}
