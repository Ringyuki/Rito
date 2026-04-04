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

  const ref = useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect();
    if (!node) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
    });
    observer.observe(node);
    observerRef.current = observer;

    // Set initial size
    const { width, height } = node.getBoundingClientRect();
    setSize({ width, height });
  }, []);

  return [ref, size];
}
