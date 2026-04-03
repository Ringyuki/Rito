import { useEffect, type RefObject } from 'react';

interface EpubCanvasProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  width: number;
  height: number;
  onPrev: () => void;
  onNext: () => void;
  onFirst: () => void;
  onLast: () => void;
}

export function EpubCanvas({
  canvasRef,
  width,
  height,
  onPrev,
  onNext,
  onFirst,
  onLast,
}: EpubCanvasProps) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault();
          onPrev();
          break;
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          e.preventDefault();
          onNext();
          break;
        case 'Home':
          e.preventDefault();
          onFirst();
          break;
        case 'End':
          e.preventDefault();
          onLast();
          break;
      }
    };

    canvas.addEventListener('keydown', handleKeyDown);
    return () => {
      canvas.removeEventListener('keydown', handleKeyDown);
    };
  }, [canvasRef, onPrev, onNext, onFirst, onLast]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      tabIndex={0}
      className="rounded-lg border border-border shadow-lg outline-none focus:ring-2 focus:ring-ring"
    />
  );
}
