/**
 * Bind clipboard copy to a SelectionEngine.
 * Listens for Ctrl+C / Cmd+C and writes selected text to clipboard.
 */

import type { SelectionEngine } from '../selection';

/**
 * Bind clipboard copy support. Returns a cleanup function.
 */
export function bindClipboard(canvas: HTMLCanvasElement, engine: SelectionEngine): () => void {
  function onKeyDown(e: KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
      const text = engine.getText();
      if (text.length > 0) {
        void navigator.clipboard.writeText(text);
        e.preventDefault();
      }
    }
  }

  canvas.addEventListener('keydown', onKeyDown);
  try {
    canvas.setAttribute('tabindex', '0');
  } catch (error: unknown) {
    canvas.removeEventListener('keydown', onKeyDown);
    throw error;
  }

  return () => {
    canvas.removeEventListener('keydown', onKeyDown);
  };
}
