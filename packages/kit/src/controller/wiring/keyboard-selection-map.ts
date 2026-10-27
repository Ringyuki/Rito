import type { ReaderTextSelectionMovement, ReaderWritingMode } from '@ritojs/core';

/**
 * The selection movement a Shift chord asks for with the selection's focus
 * on a line of `writingMode`. An arrow key is first read as the key on that
 * side of the line, as the browser transposes arrows by the focus's writing
 * mode before interpreting them: on a vertical-rl line down moves along the
 * line, up back along it, left on to the next line and right back to the
 * previous one, with the same modifiers.
 */
export function keyboardSelectionMovement(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey' | 'isComposing'>,
  apple: boolean,
  writingMode: ReaderWritingMode = 'horizontal-tb',
): ReaderTextSelectionMovement | null {
  if (!event.shiftKey || event.isComposing) return null;
  const read = {
    key: transposedArrowKey(event.key, writingMode),
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
  };
  return apple ? appleMovement(read) : otherPlatformMovement(read);
}

/** Each arrow key read on a vertical-rl line as the horizontal key on its side. */
const VERTICAL_RL_ARROWS: Readonly<Record<string, string>> = {
  ArrowLeft: 'ArrowDown',
  ArrowRight: 'ArrowUp',
  ArrowUp: 'ArrowLeft',
  ArrowDown: 'ArrowRight',
};

function transposedArrowKey(key: string, writingMode: ReaderWritingMode): string {
  if (writingMode === 'horizontal-tb') return key;
  return VERTICAL_RL_ARROWS[key] ?? key;
}

export function isAppleKeyboardPlatform(value: Navigator): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(`${value.platform} ${value.userAgent}`);
}

function appleMovement(
  event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey'>,
): ReaderTextSelectionMovement | null {
  if (!event.altKey && !event.ctrlKey && !event.metaKey) return plainMovement(event.key);
  if (event.altKey && !event.ctrlKey && !event.metaKey) {
    return horizontalOrParagraphMovement(event.key);
  }
  if (event.metaKey && !event.altKey && !event.ctrlKey) return lineOrDocumentMovement(event.key);
  return null;
}

function otherPlatformMovement(
  event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey'>,
): ReaderTextSelectionMovement | null {
  if (event.altKey || event.metaKey) return null;
  if (event.ctrlKey) {
    if (event.key === 'Home') return 'documentStart';
    if (event.key === 'End') return 'documentEnd';
    return windowsControlMovement(event.key);
  }
  if (event.key === 'Home') return 'lineStart';
  if (event.key === 'End') return 'lineEnd';
  return plainMovement(event.key);
}

function windowsControlMovement(key: string): ReaderTextSelectionMovement | null {
  if (key === 'ArrowLeft') return 'wordLeft';
  if (key === 'ArrowRight') return 'wordStartRight';
  if (key === 'ArrowUp') return 'paragraphPreviousStart';
  if (key === 'ArrowDown') return 'paragraphNextStart';
  return null;
}

function plainMovement(key: string): ReaderTextSelectionMovement | null {
  if (key === 'ArrowLeft') return 'characterLeft';
  if (key === 'ArrowRight') return 'characterRight';
  if (key === 'ArrowUp') return 'lineUp';
  if (key === 'ArrowDown') return 'lineDown';
  if (key === 'PageUp') return 'pageUp';
  if (key === 'PageDown') return 'pageDown';
  return null;
}

function horizontalOrParagraphMovement(key: string): ReaderTextSelectionMovement | null {
  if (key === 'ArrowLeft') return 'wordLeft';
  if (key === 'ArrowRight') return 'wordRight';
  if (key === 'ArrowUp') return 'paragraphBackward';
  if (key === 'ArrowDown') return 'paragraphForward';
  return null;
}

function lineOrDocumentMovement(key: string): ReaderTextSelectionMovement | null {
  if (key === 'ArrowLeft') return 'lineStart';
  if (key === 'ArrowRight') return 'lineEnd';
  if (key === 'ArrowUp') return 'documentStart';
  if (key === 'ArrowDown') return 'documentEnd';
  return null;
}
