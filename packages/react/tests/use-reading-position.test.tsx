// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ReaderController, ReaderControllerEvents, ReadingPosition } from '@ritojs/kit';
import { useReadingPosition } from '../src/hooks/use-reading-position';

const at = (spreadIndex: number, progress: number): ReadingPosition => ({
  projection: { spreadIndex, pageIndex: spreadIndex },
  progress,
  timestamp: 0,
});

describe('useReadingPosition', () => {
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

  it('starts from the controller position, follows it, and never keeps another book', () => {
    const first = controllerStub(at(3, 0.1));
    const second = controllerStub(null);
    let latest: ReadingPosition | null | undefined;
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
    expect(latest?.projection.spreadIndex).toBe(3);
    act(() => {
      first.emit('positionChange', { position: at(4, 0.2) });
    });
    expect(latest?.progress).toBe(0.2);

    render(second.controller);
    expect(latest).toBeNull();
  });
});

function Harness({
  controller,
  onValue,
}: {
  readonly controller: ReaderController;
  readonly onValue: (value: ReadingPosition | null) => void;
}) {
  onValue(useReadingPosition(controller).position);
  return null;
}

function controllerStub(position: ReadingPosition | null): {
  readonly controller: ReaderController;
  emit<K extends keyof ReaderControllerEvents>(event: K, value: ReaderControllerEvents[K]): void;
} {
  const listeners = new Map<keyof ReaderControllerEvents, Set<(value: never) => void>>();
  const controller = {
    position,
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
