import { describe, expect, it } from 'vitest';
import { keyboardSelectionMovement } from '../src/controller/wiring/keyboard-selection-map';

describe('platform keyboard selection mapping', () => {
  it.each([
    ['ArrowLeft', {}, 'characterLeft'],
    ['ArrowRight', {}, 'characterRight'],
    ['ArrowUp', {}, 'lineUp'],
    ['ArrowDown', {}, 'lineDown'],
    ['ArrowLeft', { altKey: true }, 'wordLeft'],
    ['ArrowRight', { altKey: true }, 'wordRight'],
    ['ArrowUp', { altKey: true }, 'paragraphBackward'],
    ['ArrowDown', { altKey: true }, 'paragraphForward'],
    ['ArrowLeft', { metaKey: true }, 'lineStart'],
    ['ArrowDown', { metaKey: true }, 'chapterEnd'],
  ] as const)('maps macOS Shift+%s with %o to %s', (key, modifiers, expected) => {
    expect(keyboardSelectionMovement(event(key, modifiers), true)).toBe(expected);
  });

  it.each([
    ['ArrowLeft', {}, 'characterLeft'],
    ['ArrowDown', {}, 'lineDown'],
    ['Home', {}, 'lineStart'],
    ['End', {}, 'lineEnd'],
    ['ArrowRight', { ctrlKey: true }, 'wordStartRight'],
    ['ArrowUp', { ctrlKey: true }, 'paragraphPreviousStart'],
    ['ArrowDown', { ctrlKey: true }, 'paragraphNextStart'],
    ['Home', { ctrlKey: true }, 'chapterStart'],
    ['End', { ctrlKey: true }, 'chapterEnd'],
  ] as const)('maps Windows/Linux Shift+%s with %o to %s', (key, modifiers, expected) => {
    expect(keyboardSelectionMovement(event(key, modifiers), false)).toBe(expected);
  });

  it('rejects non-selection, composing, and mixed-modifier chords', () => {
    expect(keyboardSelectionMovement(event('ArrowLeft', { shiftKey: false }), false)).toBeNull();
    expect(keyboardSelectionMovement(event('ArrowLeft', { isComposing: true }), false)).toBeNull();
    expect(
      keyboardSelectionMovement(event('ArrowLeft', { ctrlKey: true, altKey: true }), false),
    ).toBeNull();
    expect(
      keyboardSelectionMovement(event('ArrowLeft', { metaKey: true, altKey: true }), true),
    ).toBeNull();
  });
});

function event(
  key: string,
  overrides: Partial<
    Pick<KeyboardEvent, 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey' | 'isComposing'>
  > = {},
) {
  return {
    key,
    shiftKey: true,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    isComposing: false,
    ...overrides,
  };
}
