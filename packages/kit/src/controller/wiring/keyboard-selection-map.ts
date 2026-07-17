import type { ReaderTextSelectionMovement } from '@ritojs/core';

export function keyboardSelectionMovement(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey' | 'isComposing'>,
  apple: boolean,
): ReaderTextSelectionMovement | null {
  if (!event.shiftKey || event.isComposing) return null;
  return apple ? appleMovement(event) : otherPlatformMovement(event);
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
