import type { SelectionEngine } from 'rito/selection';

export function bindPointerEvents(
  canvas: HTMLCanvasElement,
  engine: SelectionEngine,
  toContent: (e: PointerEvent) => { x: number; y: number },
  onSingleClick?: (pos: { x: number; y: number }) => void,
): () => void {
  let downPos: { x: number; y: number } | null = null;

  const onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return; // handled by unified touch handler
    if (e.button !== 0) return;
    const pos = toContent(e);
    downPos = pos;
    engine.handlePointerDown(pos);
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return;
    engine.handlePointerMove(toContent(e));
  };
  const onUp = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return;
    const pos = toContent(e);
    engine.handlePointerUp(pos);
    if (downPos && Math.abs(pos.x - downPos.x) < 3 && Math.abs(pos.y - downPos.y) < 3) {
      onSingleClick?.(pos);
    }
    downPos = null;
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
  };
}
