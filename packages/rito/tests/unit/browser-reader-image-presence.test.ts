import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  browserReaderImageFallback,
  browserReaderImageOpacity,
  noteBrowserReaderImageLoading,
  noteBrowserReaderImageRetryable,
  noteBrowserReaderImageSettled,
  noteBrowserReaderSpreadShown,
} from '../../src/bindings/browser/image-presence';
import type { BrowserReaderState } from '../../src/bindings/browser/reader/types';

function readerState(): { readonly state: BrowserReaderState; readonly invalidated: number[] } {
  const invalidated: number[] = [];
  const state = {
    disposed: false,
    activeSpreadIndex: 0,
    frames: new Map([
      [0, { resourceRefs: { images: ['plate.png'] } }],
      [1, { resourceRefs: { images: ['other.png'] } }],
    ]),
    spreadContentInvalidatedListeners: new Set([(index: number) => invalidated.push(index)]),
  } as unknown as BrowserReaderState;
  return { state, invalidated };
}

describe('browser reader image presence', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'performance', 'requestAnimationFrame', 'Date'],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows nothing for a second, then the loading placeholder, and repaints at that moment', () => {
    const { state, invalidated } = readerState();
    noteBrowserReaderImageLoading(state, 'plate.png');
    vi.advanceTimersByTime(999);
    expect(browserReaderImageFallback(state, 'plate.png', false, false)).toBeUndefined();
    expect(invalidated).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(browserReaderImageFallback(state, 'plate.png', false, false)).toBe('loading');
    expect(invalidated).toEqual([0]);
  });

  it('notifies each spread once even when its repaint reorders the frame cache', () => {
    const invalidated: number[] = [];
    const frames = new Map([
      [0, { resourceRefs: { images: ['plate.png'] } }],
      [1, { resourceRefs: { images: ['plate.png'] } }],
      [2, { resourceRefs: { images: ['other.png'] } }],
    ]);
    const state = {
      disposed: false,
      activeSpreadIndex: 0,
      frames,
      spreadContentInvalidatedListeners: new Set([
        (index: number) => {
          invalidated.push(index);
          // A repaint reads the frame, which moves it to the end of the cache.
          const frame = frames.get(index);
          if (frame) {
            frames.delete(index);
            frames.set(index, frame);
          }
          if (invalidated.length > 10) throw new Error('notifications did not stop');
        },
      ]),
    } as unknown as BrowserReaderState;
    noteBrowserReaderImageLoading(state, 'plate.png');
    vi.advanceTimersByTime(1000);
    expect(invalidated).toEqual([0, 1]);
  });

  it('paints an image that arrives in time at once, and fades a late one in over its placeholder', () => {
    const { state } = readerState();
    noteBrowserReaderImageLoading(state, 'plate.png');
    vi.advanceTimersByTime(300);
    noteBrowserReaderImageSettled(state, 'plate.png', true);
    expect(browserReaderImageFallback(state, 'plate.png', true, false)).toBeUndefined();
    expect(browserReaderImageOpacity(state, 'plate.png')).toBe(1);

    noteBrowserReaderImageLoading(state, 'other.png');
    vi.advanceTimersByTime(1500);
    noteBrowserReaderImageSettled(state, 'other.png', true);
    expect(browserReaderImageFallback(state, 'other.png', true, false)).toBe('loading');
    expect(browserReaderImageOpacity(state, 'other.png')).toBe(0);
    vi.advanceTimersByTime(75);
    expect(browserReaderImageOpacity(state, 'other.png')).toBeCloseTo(0.5, 1);
    vi.advanceTimersByTime(200);
    expect(browserReaderImageOpacity(state, 'other.png')).toBe(1);
    expect(browserReaderImageFallback(state, 'other.png', true, false)).toBeUndefined();
  });

  it('retries a failure that can pass after 2s, 5s and 15s while its page is shown', () => {
    const { state } = readerState();
    const retry = vi.fn(() => {
      noteBrowserReaderImageRetryable(state, 'plate.png', retry);
    });
    noteBrowserReaderImageRetryable(state, 'plate.png', retry);
    expect(browserReaderImageFallback(state, 'plate.png', false, true)).toBe('broken');
    vi.advanceTimersByTime(1999);
    expect(retry).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(retry).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(retry).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(15000);
    expect(retry).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(15000);
    expect(retry).toHaveBeenCalledTimes(4);
  });

  it('waits for a hidden page to be shown again, then retries at once', () => {
    const { state } = readerState();
    const retry = vi.fn();
    noteBrowserReaderSpreadShown(state, 1);
    (state as { activeSpreadIndex: number }).activeSpreadIndex = 1;
    noteBrowserReaderImageRetryable(state, 'plate.png', retry);
    vi.advanceTimersByTime(60000);
    expect(retry).not.toHaveBeenCalled();
    noteBrowserReaderSpreadShown(state, 0);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
