import { useEffect, useRef, useState } from 'react';

export interface ContainerSize {
  width: number;
  height: number;
}

/**
 * Track the size of a DOM element via ResizeObserver.
 * Returns [ref, size] — attach the ref to the element you want to measure.
 */
export function useContainerSize(): [React.RefObject<HTMLElement | null>, ContainerSize] {
  const ref = useRef<HTMLElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((prev) => {
        // Only update if changed meaningfully (avoid sub-pixel thrash)
        if (Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1) return prev;
        return { width: Math.floor(width), height: Math.floor(height) };
      });
    });

    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  return [ref, size];
}
