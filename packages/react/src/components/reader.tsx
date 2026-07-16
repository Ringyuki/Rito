import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReaderController } from '@ritojs/kit';
import { SelectionHandles } from './selection-handles';

export interface ReaderProps {
  readonly controller: ReaderController | null;
  readonly className?: string | undefined;
  readonly placeholder?: React.ReactNode;
  readonly children?: React.ReactNode;
}

/**
 * Mounts the controller's DOM elements (transition canvases + overlay canvas).
 * Fills its parent container — apply sizing via className or parent layout.
 *
 * NOTE: This component does NOT call controller.resize(). The consumer is
 * responsible for calling resize() with the correct viewport dimensions.
 */
export function Reader({
  controller,
  className,
  placeholder,
  children,
}: ReaderProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const [touchInput, setTouchInput] = useState(false);

  const mountController = useCallback(() => {
    const container = containerRef.current;
    if (!container || !controller || mountedRef.current) return;
    controller.mount(container);
    mountedRef.current = true;
  }, [controller]);

  useEffect(() => {
    setTouchInput(false);
    mountController();
    return () => {
      mountedRef.current = false;
    };
  }, [mountController]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: 'relative' }}
      onPointerDownCapture={(event) => {
        setTouchInput(event.pointerType === 'touch' || event.pointerType === 'pen');
      }}
      onTouchStartCapture={() => {
        setTouchInput(true);
      }}
    >
      {!controller && placeholder}
      {children}
      <SelectionHandles controller={controller} rootRef={containerRef} touchInput={touchInput} />
    </div>
  );
}
