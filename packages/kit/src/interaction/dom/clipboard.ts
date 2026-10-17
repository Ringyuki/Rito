/**
 * Bind clipboard copy to a SelectionEngine.
 * Listens for Ctrl+C / Cmd+C and writes selected text to clipboard.
 */

import type { SelectionEngine } from '../selection';

/**
 * Bind clipboard copy support. Returns a cleanup function, which also gives
 * the canvas back its own `tabindex` and inline `outline-style`.
 *
 * The canvas is made focusable so the reader receives keys, and its focus
 * ring is turned off: the browser's ring would outline the whole reading
 * surface after any key press, marking nothing a reader can act on. A host
 * that wants a ring sets the canvas's inline `outline` (or `outline-style`)
 * after the controller is created.
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

  const restoreFocus = borrowFocus(canvas);
  canvas.addEventListener('keydown', onKeyDown);
  try {
    canvas.setAttribute('tabindex', '0');
    canvas.style.outlineStyle = 'none';
  } catch (error: unknown) {
    canvas.removeEventListener('keydown', onKeyDown);
    restoreFocus();
    throw error;
  }

  return () => {
    canvas.removeEventListener('keydown', onKeyDown);
    restoreFocus();
  };
}

/** Remembers the canvas's focus attributes as the host left them. */
function borrowFocus(canvas: HTMLCanvasElement): () => void {
  const tabIndex = canvas.getAttribute('tabindex');
  const outlineStyle = canvas.style.outlineStyle;
  return () => {
    if (tabIndex === null) canvas.removeAttribute('tabindex');
    else canvas.setAttribute('tabindex', tabIndex);
    canvas.style.outlineStyle = outlineStyle;
  };
}
