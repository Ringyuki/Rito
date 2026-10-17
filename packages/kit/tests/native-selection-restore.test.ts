import { describe, expect, it, vi } from 'vitest';
import type { ReaderTextSelectionInteractions } from '@ritojs/core';
import { createNativeSelectionEngine } from '../src/interaction/selection/native-engine';
import { capabilityFrom, caret, exactRange, point } from './helpers/native-selection';

describe('native selection restore', () => {
  it('shows a carried range as the selection when none is being made or shown', () => {
    const engine = createNativeSelectionEngine(
      capabilityFrom(
        vi.fn<ReaderTextSelectionInteractions['resolveCaret']>(),
        vi.fn<ReaderTextSelectionInteractions['resolveTextRange']>(),
      ),
    );
    const listener = vi.fn();
    engine.onChange(listener);
    const range = exactRange(caret(2), caret(6), 'backward', 'kept');

    engine.restore(range);

    expect(engine.getState()).toBe('selected');
    expect(engine.getSnapshot()).toMatchObject({
      range,
      text: 'kept',
      focusDirection: 'backward',
    });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('leaves a selection being made, and an empty range, alone', () => {
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockReturnValue(new Promise(() => undefined));
    const engine = createNativeSelectionEngine(
      capabilityFrom(resolveCaret, vi.fn<ReaderTextSelectionInteractions['resolveTextRange']>()),
    );
    engine.restore(exactRange(caret(2), caret(2), 'forward', ''));
    expect(engine.getState()).toBe('idle');

    engine.handlePointerDown(point(1));
    engine.restore(exactRange(caret(2), caret(6), 'forward', 'late'));
    expect(engine.getState()).toBe('selecting');
    expect(engine.getSnapshot()).toBeNull();
  });
});
