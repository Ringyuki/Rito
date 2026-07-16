import { describe, expect, it, vi } from 'vitest';
import { buildAnnotationActions } from '../src/controller/facade/annotation-actions';
import type { Internals } from '../src/controller/facade';
import { createEmitter } from '../src/utils/event-emitter';
import type { AnnotationStore } from '../src/interaction';
import type { ReaderControllerEvents } from '../src/controller/types';

describe('annotation persistence errors', () => {
  it('reports a rejected save without creating an unhandled rejection', async () => {
    const failure = new Error('annotation save failed');
    const store = {
      remove: vi.fn(() => true),
      persist: vi.fn(() => Promise.reject(failure)),
    } as unknown as AnnotationStore;
    const emitter = createEmitter<ReaderControllerEvents>();
    const errors = vi.fn();
    emitter.on('error', errors);
    const actions = buildAnnotationActions(
      { coordState: { annotationStore: store } } as unknown as Internals,
      emitter,
    );

    expect(actions.removeAnnotation('saved-id')).toBe(true);
    await vi.waitFor(() => {
      expect(errors).toHaveBeenCalledWith({
        message: failure.message,
        source: 'annotation-storage',
      });
    });
  });

  it('contains an error listener failure while reporting a rejected save', async () => {
    const store = {
      remove: vi.fn(() => true),
      persist: vi.fn(() => Promise.reject(new Error('save failed'))),
    } as unknown as AnnotationStore;
    const emitter = createEmitter<ReaderControllerEvents>();
    const listener = vi.fn(() => {
      throw new Error('consumer failed');
    });
    emitter.on('error', listener);
    const actions = buildAnnotationActions(
      { coordState: { annotationStore: store } } as unknown as Internals,
      emitter,
    );

    expect(actions.removeAnnotation('saved-id')).toBe(true);
    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledOnce();
    });
  });
});
