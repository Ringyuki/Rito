import { describe, expect, it, vi } from 'vitest';
import { createEmitter } from '../src/utils/event-emitter';

describe('event emitter lifecycle', () => {
  it('clears existing listeners and remains terminal after disposal', () => {
    const emitter = createEmitter<{ change: number }>();
    const beforeDispose = vi.fn();
    const afterDispose = vi.fn();
    const unsubscribe = emitter.on('change', beforeDispose);

    emitter.dispose();
    emitter.emit('change', 1);
    emitter.on('change', afterDispose);
    emitter.emit('change', 2);

    expect(beforeDispose).not.toHaveBeenCalled();
    expect(afterDispose).not.toHaveBeenCalled();
    expect(() => {
      unsubscribe();
      emitter.dispose();
    }).not.toThrow();
  });
});
