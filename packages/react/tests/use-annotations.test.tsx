// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AnnotationRecord, ReaderController } from '@ritojs/kit';
import { useAnnotations } from '../src/hooks';

type Listener = (data: unknown) => void;

/** A controller holding `records`, whose events the test raises. */
function fakeController(records: readonly AnnotationRecord[]) {
  const listeners = new Map<string, Listener[]>();
  const controller = {
    annotations: records,
    on(event: string, listener: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return () => {
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((each) => each !== listener),
        );
      };
    },
    emit(event: string, data: unknown) {
      for (const listener of listeners.get(event) ?? []) listener(data);
    },
  };
  return controller;
}

function record(id: string): AnnotationRecord {
  return { id, kind: 'highlight', createdAt: 1 } as unknown as AnnotationRecord;
}

let root: Root;
let host: HTMLElement;
let value: ReturnType<typeof useAnnotations> | null;

function Harness({ controller }: { controller: ReaderController | null }) {
  value = useAnnotations(controller);
  return null;
}

beforeEach(() => {
  value = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
});

describe('useAnnotations', () => {
  it('starts from the records a controller holds, as its storage gave them before any event', () => {
    const first = fakeController([record('a'), record('b')]);
    act(() => {
      root.render(<Harness controller={first as unknown as ReaderController} />);
    });
    expect(value?.annotations.map((each) => each.id)).toEqual(['a', 'b']);

    // Another book's controller, its records already loaded.
    const second = fakeController([record('c')]);
    act(() => {
      root.render(<Harness controller={second as unknown as ReaderController} />);
    });
    expect(value?.annotations.map((each) => each.id)).toEqual(['c']);

    act(() => {
      second.emit('annotationsChange', { annotations: [record('c'), record('d')] });
    });
    expect(value?.annotations.map((each) => each.id)).toEqual(['c', 'd']);

    act(() => {
      root.render(<Harness controller={null} />);
    });
    expect(value?.annotations).toEqual([]);
  });
});
