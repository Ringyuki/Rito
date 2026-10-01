import { describe, expect, it, vi } from 'vitest';
import type { ReaderLocator } from '@ritojs/core';
import { buildAnnotationActions } from '../src/controller/facade/annotation-actions';
import type { ReaderControllerEvents } from '../src/controller/types';
import { createEmitter } from '../src/utils/event-emitter';
import { buildAnnotationTargetFromLocator } from '../src/controller/annotation-resolution';
import type { Internals } from '../src/controller/core/internals';
import { annotationTarget } from './annotation-target-fixture';

const sourceRange = {
  start: { nodePath: [0], textOffset: 2 },
  end: { nodePath: [0], textOffset: 6 },
};

describe('native selection annotation target', () => {
  it('fails closed for a cross-resource selection without a compatible locator', async () => {
    const add = vi.fn();
    const create = vi.fn();
    const actions = buildAnnotationActions(
      internalsFor({ locator: null, create, store: { add } }),
      createEmitter<ReaderControllerEvents>(),
    );

    await expect(actions.addAnnotation({ kind: 'highlight' })).resolves.toBeUndefined();
    expect(create).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('stores the target the engine built for the selection read at call time', async () => {
    const target = annotationTarget('2345');
    const add = vi.fn((draft: object) => ({ id: 'a', createdAt: 1, ...draft }));
    const getSourceLocator = vi.fn(() => ({ href: 'chapter.xhtml', sourceRange }));
    const create = vi.fn(() => Promise.resolve(target));
    const actions = buildAnnotationActions(
      internalsFor({ locator: getSourceLocator, create, store: { add } }),
      createEmitter<ReaderControllerEvents>(),
    );

    const pending = actions.addAnnotation({ kind: 'highlight', color: '#ff0' });
    expect(getSourceLocator).toHaveBeenCalledOnce();
    const record = await pending;

    expect(create).toHaveBeenCalledWith({ href: 'chapter.xhtml', sourceRange });
    expect(add).toHaveBeenCalledWith({ kind: 'highlight', target, color: '#ff0' });
    expect(record?.target).toBe(target);
  });

  it('drops the record when the store was replaced while the engine built it', async () => {
    const add = vi.fn();
    let finish: (value: ReturnType<typeof annotationTarget>) => void = () => {};
    const internals = internalsFor({
      locator: () => ({ href: 'chapter.xhtml', sourceRange }),
      create: () => new Promise((resolve) => (finish = resolve)),
      store: { add },
    });
    const actions = buildAnnotationActions(internals, createEmitter<ReaderControllerEvents>());

    const pending = actions.addAnnotation({ kind: 'highlight' });
    (internals.coordState as { annotationStore: unknown }).annotationStore = null;
    finish(annotationTarget());

    await expect(pending).resolves.toBeUndefined();
    expect(add).not.toHaveBeenCalled();
  });

  it('asks the engine with the exact source range and refuses a locator without one', async () => {
    const create = vi.fn(() => Promise.resolve(annotationTarget()));
    const internals = internalsFor({ locator: null, create, store: {} });
    const locator: ReaderLocator = { href: 'chapter.xhtml', sourceRange };

    await expect(buildAnnotationTargetFromLocator(locator, internals)).resolves.toEqual(
      annotationTarget(),
    );
    await expect(
      buildAnnotationTargetFromLocator({ href: 'chapter.xhtml' }, internals),
    ).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledOnce();
  });
});

function internalsFor(options: {
  readonly locator: (() => ReaderLocator | null) | null;
  readonly create: (...args: never[]) => unknown;
  readonly store: object;
}): Internals {
  return {
    engines: { selection: { getSourceLocator: options.locator ?? (() => null) } },
    coordState: {
      annotationStore: { persist: () => Promise.resolve(), getAll: () => [], ...options.store },
    },
    reader: { interactions: { createAnnotationTarget: options.create } },
  } as unknown as Internals;
}

describe('native selection annotation failures', () => {
  it('reports an engine failure on the error event instead of rejecting', async () => {
    const emitter = createEmitter<ReaderControllerEvents>();
    const errors = vi.fn();
    emitter.on('error', errors);
    const actions = buildAnnotationActions(
      internalsFor({
        locator: () => ({ href: 'chapter.xhtml', sourceRange }),
        create: () => Promise.reject(new Error('an annotation target cannot be empty')),
        store: { add: vi.fn() },
      }),
      emitter,
    );

    await expect(actions.addAnnotation({ kind: 'highlight' })).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalledWith({
      message: 'an annotation target cannot be empty',
      source: 'annotation-target',
    });
  });
});
