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
  if (!event.altKey && !event.ctrlKey && !event.metaKey) return plainArrowMovement(event.key);
  if (event.altKey && !event.ctrlKey && !event.metaKey) {
    return horizontalOrParagraphMovement(event.key);
  }
  if (event.metaKey && !event.altKey && !event.ctrlKey) return lineOrChapterMovement(event.key);
  return null;
}

function otherPlatformMovement(
  event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey'>,
): ReaderTextSelectionMovement | null {
  if (event.altKey || event.metaKey) return null;
  if (event.ctrlKey) {
    if (event.key === 'Home') return 'chapterStart';
    if (event.key === 'End') return 'chapterEnd';
    return windowsControlMovement(event.key);
  }
  if (event.key === 'Home') return 'lineStart';
  if (event.key === 'End') return 'lineEnd';
  return plainArrowMovement(event.key);
}

function windowsControlMovement(key: string): ReaderTextSelectionMovement | null {
  if (key === 'ArrowLeft') return 'wordLeft';
  if (key === 'ArrowRight') return 'wordStartRight';
  if (key === 'ArrowUp') return 'paragraphPreviousStart';
  if (key === 'ArrowDown') return 'paragraphNextStart';
  return null;
}

function plainArrowMovement(key: string): ReaderTextSelectionMovement | null {
  if (key === 'ArrowLeft') return 'characterLeft';
  if (key === 'ArrowRight') return 'characterRight';
  if (key === 'ArrowUp') return 'lineUp';
  if (key === 'ArrowDown') return 'lineDown';
  return null;
}

function horizontalOrParagraphMovement(key: string): ReaderTextSelectionMovement | null {
  if (key === 'ArrowLeft') return 'wordLeft';
  if (key === 'ArrowRight') return 'wordRight';
  if (key === 'ArrowUp') return 'paragraphBackward';
  if (key === 'ArrowDown') return 'paragraphForward';
  return null;
}

function lineOrChapterMovement(key: string): ReaderTextSelectionMovement | null {
  if (key === 'ArrowLeft') return 'lineStart';
  if (key === 'ArrowRight') return 'lineEnd';
  if (key === 'ArrowUp') return 'chapterStart';
  if (key === 'ArrowDown') return 'chapterEnd';
  return null;
}
