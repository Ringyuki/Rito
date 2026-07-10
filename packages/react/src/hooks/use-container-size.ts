import { useCallback, useRef, useState } from 'react';

export interface ContainerSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Track the size of an element using ResizeObserver.
 * Returns a ref callback and the current size.
 */
export function useContainerSize(): [ref: (node: HTMLElement | null) => void, size: ContainerSize] {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observerRef = useRef<ResizeObserver | null>(null);
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<ContainerSize | null>(null);

  const ref = useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect();
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (!node) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      scheduleSizeUpdate({ width, height });
    });
    observer.observe(node);
    observerRef.current = observer;

    // Set initial size
    const { width, height } = node.getBoundingClientRect();
    scheduleSizeUpdate({ width, height });
  }, []);

  function scheduleSizeUpdate(next: ContainerSize): void {
    pendingRef.current = next;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (!pending) return;
      setSize((prev) =>
        prev.width === pending.width && prev.height === pending.height ? prev : pending,
      );
    });
  }

  return [ref, size];
}
