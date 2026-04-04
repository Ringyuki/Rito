import { useCallback, useEffect, useRef } from 'react';
import type { ReaderController } from '@rito/kit';

export interface ReaderCanvasProps {
  readonly controller: ReaderController | null;
  readonly width: number;
  readonly height: number;
  readonly className?: string | undefined;
  readonly placeholder?: React.ReactNode;
}

/**
 * Mounts the controller's DOM elements (transition canvases + overlay canvas).
 * The controller manages its own canvas elements internally.
 */
export function ReaderCanvas({
  controller,
  width,
  height,
  className,
  placeholder,
}: ReaderCanvasProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);

  // Mount controller into container
  const mountController = useCallback(() => {
    const container = containerRef.current;
    if (!container || !controller || mountedRef.current) return;
    controller.mount(container);
    mountedRef.current = true;
  }, [controller]);

  useEffect(() => {
    mountController();
    return () => {
      mountedRef.current = false;
    };
  }, [mountController]);

  // Sync size
  useEffect(() => {
    if (!controller || width === 0 || height === 0) return;
    controller.resize(width, height);
  }, [controller, width, height]);

  const isLoaded = controller?.isLoaded ?? false;

  return (
    <div ref={containerRef} className={className} style={{ position: 'relative', width, height }}>
      {!isLoaded && placeholder}
    </div>
  );
}
