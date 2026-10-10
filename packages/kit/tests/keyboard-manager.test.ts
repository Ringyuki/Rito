// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKeyboardManager, type KeyboardManager } from '../src/keyboard/index';

let keyboard: KeyboardManager | undefined;

afterEach(() => {
  keyboard?.dispose();
  keyboard = undefined;
  document.body.replaceChildren();
});

function press(target: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe('keyboard manager', () => {
  it('runs the shortcut a key is bound to and takes the key', () => {
    const nextPage = vi.fn();
    keyboard = createKeyboardManager(document.documentElement);
    keyboard.register('ArrowRight', nextPage);

    const event = press(document.body, 'ArrowRight');

    expect(nextPage).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves a key that a widget on the page has already handled', () => {
    const nextPage = vi.fn();
    keyboard = createKeyboardManager(document.documentElement);
    keyboard.register('ArrowRight', nextPage);
    const slider = document.createElement('span');
    slider.setAttribute('role', 'slider');
    slider.tabIndex = 0;
    slider.addEventListener('keydown', (event) => {
      event.preventDefault();
    });
    document.body.append(slider);

    press(slider, 'ArrowRight');

    expect(nextPage).not.toHaveBeenCalled();
  });

  it('leaves keys typed into a field', () => {
    const nextPage = vi.fn();
    keyboard = createKeyboardManager(document.documentElement);
    keyboard.register('ArrowRight', nextPage);
    const field = document.createElement('input');
    document.body.append(field);

    const event = press(field, 'ArrowRight');

    expect(nextPage).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
