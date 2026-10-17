import { describe, expect, it, vi } from 'vitest';
import { buildAnnotationActions } from '../src/controller/facade/annotation-actions';
import type { Internals } from '../src/controller/facade';
import type { ReaderControllerEvents } from '../src/controller/types';
import { createAnnotationStore, type AnnotationRecord } from '../src/interaction';
import { createEmitter } from '../src/utils/event-emitter';
import { annotationTarget } from './annotation-target-fixture';

describe('inserting a whole annotation record', () => {
  it('puts a removed record back where it was, colour and note included', async () => {
    const save = vi.fn<(records: readonly AnnotationRecord[]) => Promise<void>>(() =>
      Promise.resolve(),
    );
    const store = createAnnotationStore();
    await store.init({ load: () => Promise.resolve([first, noted, last]), save });
    const actions = actionsOver(store);

    expect(actions.removeAnnotation(noted.id)).toBe(true);
    expect(actions.insertAnnotation(noted)).toBe(true);

    expect(actions.annotations).toEqual([first, noted, last]);
    await vi.waitFor(() => {
      expect(save).toHaveBeenLastCalledWith([first, noted, last]);
    });
  });

  it('replaces the record with its id where it stands, so an edit is undone whole', async () => {
    // Stored records need not be in creation order (synced from elsewhere).
    const store = createAnnotationStore();
    await store.init({ load: () => Promise.resolve([last, plain, first]), save: vi.fn() });
    const actions = actionsOver(store);

    actions.updateAnnotation(plain.id, { note: 'added later', color: '#00ff00' });
    actions.insertAnnotation(plain);

    expect(actions.annotations).toEqual([last, plain, first]);
  });

  it('merges a record put back while storage is still loading', async () => {
    let finishLoad!: (records: readonly AnnotationRecord[]) => void;
    const loading = new Promise<readonly AnnotationRecord[]>((resolve) => {
      finishLoad = resolve;
    });
    const store = createAnnotationStore();
    const initialization = store.init({ load: () => loading, save: vi.fn() });

    expect(store.insert(noted)).toBe(true);
    finishLoad([first, last]);
    await initialization;

    expect(store.getAll()).toEqual([first, noted, last]);
  });

  it('refuses once the controller has no store', () => {
    const store = createAnnotationStore();
    store.dispose();

    expect(store.insert(noted)).toBe(false);
    expect(actionsOver(undefined).insertAnnotation(noted)).toBe(false);
  });
});

const first = record('first', 1);
const noted: AnnotationRecord = {
  ...record('noted', 2),
  color: '#ff0000',
  note: 'kept',
  modifiedAt: 5,
};
const plain = record('plain', 2);
const last = record('last', 3);

function record(id: string, createdAt: number): AnnotationRecord {
  return { id, kind: 'highlight', target: annotationTarget(), createdAt };
}

function actionsOver(store: ReturnType<typeof createAnnotationStore> | undefined) {
  return buildAnnotationActions(
    { coordState: { annotationStore: store } } as unknown as Internals,
    createEmitter<ReaderControllerEvents>(),
  );
}
