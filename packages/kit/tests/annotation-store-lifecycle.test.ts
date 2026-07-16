import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAnnotationStore,
  type AnnotationRecord,
  type AnnotationTarget,
} from '../src/interaction';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AnnotationStore lifecycle', () => {
  it('normalizes a synchronous adapter load failure into its initialization promise', async () => {
    const failure = new Error('load failed synchronously');
    const store = createAnnotationStore();

    const initialization = store.init({
      load: () => {
        throw failure;
      },
      save: vi.fn(),
    });

    await expect(initialization).rejects.toBe(failure);
  });

  it('keeps a reentrant dispose terminal when the adapter load never settles', async () => {
    const store = createAnnotationStore();
    const initialization = store.init({
      load: () => {
        store.dispose();
        return new Promise<readonly AnnotationRecord[]>(() => undefined);
      },
      save: vi.fn(),
    });

    await initialization;

    expect(store.getAll()).toEqual([]);
    expect(() => {
      store.add(annotationDraft());
    }).toThrow('Cannot modify a disposed annotation store');
  });

  it('keeps a newer initialization started reentrantly by an adapter load', async () => {
    const store = createAnnotationStore();
    let replacement: Promise<void> | undefined;
    const first = store.init({
      load: () => {
        replacement = store.init({
          load: () => Promise.resolve([annotationRecord('current')]),
          save: vi.fn(),
        });
        return Promise.resolve([annotationRecord('stale')]);
      },
      save: vi.fn(),
    });

    await first;
    if (!replacement) throw new Error('Adapter load did not start its replacement');
    await replacement;

    expect(store.getAll()).toEqual([annotationRecord('current')]);
  });

  it('creates collision-free local ids when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {});
    const first = createAnnotationStore().add(annotationDraft());
    const second = createAnnotationStore().add(annotationDraft());

    expect(first.id).toMatch(/^annotation-/);
    expect(second.id).toMatch(/^annotation-/);
    expect(second.id).not.toBe(first.id);
  });

  it('replays synchronous mutations over a storage load that settles later', async () => {
    const pending = deferred<readonly AnnotationRecord[]>();
    const store = createAnnotationStore();
    const initialization = store.init({ load: () => pending.promise, save: vi.fn() });
    const kept = store.add(annotationDraft());
    const removed = store.add(annotationDraft());

    expect(store.update(kept.id, { note: 'local edit' })).toBe(true);
    expect(store.remove(removed.id)).toBe(true);
    pending.resolve([annotationRecord('persisted')]);
    await initialization;

    expect(store.getAll()).toEqual([
      annotationRecord('persisted'),
      expect.objectContaining({ id: kept.id, note: 'local edit' }),
    ]);
  });

  it('waits for the current load before persisting its merged snapshot', async () => {
    const pending = deferred<readonly AnnotationRecord[]>();
    const save = vi.fn(() => Promise.resolve());
    const store = createAnnotationStore();
    const initialization = store.init({ load: () => pending.promise, save });
    const local = store.add(annotationDraft());
    const persistence = store.persist();

    expect(save).not.toHaveBeenCalled();
    pending.resolve([annotationRecord('1')]);
    await initialization;
    await persistence;

    expect(local.id).not.toBe('1');
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith([
      annotationRecord('1'),
      expect.objectContaining({ id: local.id }),
    ]);
  });

  it('serializes persistence so a slow older save cannot overwrite a newer one', async () => {
    const firstSave = deferred<undefined>();
    const secondSave = deferred<undefined>();
    const save = vi
      .fn<(records: readonly AnnotationRecord[]) => Promise<void>>()
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise);
    const store = createAnnotationStore();
    await store.init({ load: () => Promise.resolve([]), save });
    const local = store.add(annotationDraft());

    const firstPersistence = store.persist();
    await Promise.resolve();
    expect(store.update(local.id, { note: 'newer' })).toBe(true);
    const secondPersistence = store.persist();
    await Promise.resolve();

    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[0]).toEqual([expect.objectContaining({ id: local.id })]);
    expect(save.mock.calls[0]?.[0]?.[0]).not.toHaveProperty('note');

    firstSave.resolve(undefined);
    await firstPersistence;
    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledTimes(2);
    });
    expect(save.mock.calls[1]?.[0]).toEqual([
      expect.objectContaining({ id: local.id, note: 'newer' }),
    ]);
    secondSave.resolve(undefined);
    await secondPersistence;
  });

  it('finishes an accepted save after the store is disposed', async () => {
    const save = vi.fn(() => Promise.resolve());
    const store = createAnnotationStore();
    await store.init({ load: () => Promise.resolve([]), save });
    const local = store.add(annotationDraft());

    const persistence = store.persist();
    store.dispose();
    await persistence;

    expect(save).toHaveBeenCalledWith([expect.objectContaining({ id: local.id })]);
    expect(store.getAll()).toEqual([]);
  });

  it('merges a pending load for a save accepted before disposal', async () => {
    const loaded = deferred<readonly AnnotationRecord[]>();
    const save = vi.fn(() => Promise.resolve());
    const store = createAnnotationStore();
    void store.init({ load: () => loaded.promise, save });
    const local = store.add(annotationDraft());

    const persistence = store.persist();
    store.dispose();
    loaded.resolve([annotationRecord('persisted')]);
    await persistence;

    expect(save).toHaveBeenCalledWith([
      annotationRecord('persisted'),
      expect.objectContaining({ id: local.id }),
    ]);
    expect(store.getAll()).toEqual([]);
  });

  it('only installs the latest concurrent initialization', async () => {
    const first = deferred<readonly AnnotationRecord[]>();
    const second = deferred<readonly AnnotationRecord[]>();
    const store = createAnnotationStore();
    const firstInitialization = store.init({ load: () => first.promise, save: vi.fn() });
    const secondInitialization = store.init({ load: () => second.promise, save: vi.fn() });
    const local = store.add(annotationDraft());

    second.resolve([annotationRecord('current')]);
    await secondInitialization;
    first.resolve([annotationRecord('stale')]);
    await firstInitialization;

    expect(store.getAll()).toEqual([
      annotationRecord('current'),
      expect.objectContaining({ id: local.id }),
    ]);
  });

  it('redirects a waiting persist when its initialization is superseded', async () => {
    const neverSettles = new Promise<readonly AnnotationRecord[]>(() => undefined);
    const current = deferred<readonly AnnotationRecord[]>();
    const staleSave = vi.fn(() => Promise.resolve());
    const currentSave = vi.fn(() => Promise.resolve());
    const store = createAnnotationStore();
    const staleInitialization = store.init({ load: () => neverSettles, save: staleSave });
    const persistence = store.persist();
    await Promise.resolve();

    const currentInitialization = store.init({ load: () => current.promise, save: currentSave });
    current.resolve([annotationRecord('current')]);
    await staleInitialization;
    await currentInitialization;
    await persistence;

    expect(staleSave).not.toHaveBeenCalled();
    expect(currentSave).toHaveBeenCalledWith([annotationRecord('current')]);
  });

  it('keeps following a superseding initialization when disposal races the redirect', async () => {
    const current = deferred<readonly AnnotationRecord[]>();
    const staleSave = vi.fn(() => Promise.resolve());
    const currentSave = vi.fn(() => Promise.resolve());
    const store = createAnnotationStore();
    void store.init({
      load: () => new Promise<readonly AnnotationRecord[]>(() => undefined),
      save: staleSave,
    });
    const local = store.add(annotationDraft());
    const persistence = store.persist();

    void store.init({ load: () => current.promise, save: currentSave });
    store.dispose();
    current.resolve([annotationRecord('current')]);
    await persistence;

    expect(staleSave).not.toHaveBeenCalled();
    expect(currentSave).toHaveBeenCalledWith([
      annotationRecord('current'),
      expect.objectContaining({ id: local.id }),
    ]);
  });

  it('does not install or publish a storage load that settles after disposal', async () => {
    const pending = deferred<readonly AnnotationRecord[]>();
    const store = createAnnotationStore();
    const changed = vi.fn();
    store.onChange(changed);
    const initialization = store.init({ load: () => pending.promise, save: vi.fn() });

    store.dispose();
    await initialization;
    pending.resolve([annotationRecord('persisted')]);
    await Promise.resolve();

    expect(changed).not.toHaveBeenCalled();
    expect(store.getAll()).toEqual([]);
    expect(store.remove('persisted')).toBe(false);
    expect(() => {
      store.add(annotationDraft());
    }).toThrow('Cannot modify a disposed annotation store');
  });

  it('keeps disposal idempotent and terminal for later initialization', async () => {
    const store = createAnnotationStore();
    const load = vi.fn(() => Promise.resolve([annotationRecord('late')]));

    store.dispose();
    store.dispose();
    await store.init({ load, save: vi.fn() });
    const unsubscribe = store.onChange(vi.fn());

    expect(load).not.toHaveBeenCalled();
    expect(store.getAll()).toEqual([]);
    expect(() => {
      unsubscribe();
    }).not.toThrow();
  });
});

function annotationRecord(id: string): AnnotationRecord {
  return { id, kind: 'highlight', target: annotationTarget(), createdAt: 1 };
}

function annotationDraft(): Omit<AnnotationRecord, 'id' | 'createdAt' | 'modifiedAt'> {
  return { kind: 'highlight', target: annotationTarget() };
}

function annotationTarget(): AnnotationTarget {
  return {
    href: 'chapter.xhtml',
    selectors: {
      sourceRange: {
        type: 'SourceRangeSelector',
        start: { nodePath: [0], textOffset: 0 },
        end: { nodePath: [0], textOffset: 4 },
      },
      textQuote: { type: 'TextQuoteSelector', exact: 'text' },
      textPosition: { type: 'TextPositionSelector', start: 0, end: 4 },
      progression: { type: 'ProgressionSelector', chapter: 0, chapterProgress: 0 },
    },
    text: { highlight: 'text' },
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
