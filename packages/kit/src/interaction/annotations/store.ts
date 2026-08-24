/**
 * AnnotationStore — source-anchored annotation persistence.
 * Replaces AnnotationEngine for the new annotation model.
 * No pageIndex, no TextRange — those are runtime concerns.
 */

import type { AnnotationRecord, AnnotationDraft, AnnotationRecordPatch } from './model';
import { applyStoreMutations, type StoreMutation } from './store-mutations';

/** Storage adapter for the new AnnotationRecord format. */
export interface RecordStorageAdapter {
  load(): Promise<readonly AnnotationRecord[]>;
  save(records: readonly AnnotationRecord[]): Promise<void>;
}

export interface AnnotationStore {
  init(adapter?: RecordStorageAdapter): Promise<void>;
  add(draft: AnnotationDraft): AnnotationRecord;
  remove(id: string): boolean;
  update(id: string, patch: AnnotationRecordPatch): boolean;
  getAll(): readonly AnnotationRecord[];
  getForHref(href: string): readonly AnnotationRecord[];
  persist(): Promise<void>;
  onChange(cb: (records: readonly AnnotationRecord[]) => void): () => void;
  dispose(): void;
}

interface StoreState {
  disposed: boolean;
  generation: number;
  records: AnnotationRecord[];
  adapter: RecordStorageAdapter | undefined;
  initialization: PendingInitialization | undefined;
  persistTail: Promise<void>;
  idPrefix: string;
  nextId: number;
  listeners: Set<(r: readonly AnnotationRecord[]) => void>;
}

interface PendingInitialization {
  readonly generation: number;
  readonly adapter: RecordStorageAdapter;
  readonly load: Promise<readonly AnnotationRecord[]>;
  readonly mutations: StoreMutation[];
  readonly superseded: Promise<PendingInitialization | undefined>;
  readonly supersede: (successor?: PendingInitialization) => void;
  promise: Promise<void>;
}

interface PersistenceSnapshot {
  readonly adapter: RecordStorageAdapter;
  readonly records: readonly AnnotationRecord[];
}

type CapturedPersistence =
  | PersistenceSnapshot
  | Promise<PersistenceSnapshot | undefined>
  | undefined;

let fallbackStoreSequence = 0;

export function createAnnotationStore(): AnnotationStore {
  const state: StoreState = {
    disposed: false,
    generation: 0,
    records: [],
    adapter: undefined,
    initialization: undefined,
    persistTail: Promise.resolve(),
    idPrefix: createIdPrefix(),
    nextId: 1,
    listeners: new Set(),
  };

  return {
    init: (adapter) => initFromAdapter(state, adapter),
    add: (draft) => addRecord(state, draft),
    remove: (id) => removeRecord(state, id),
    update: (id, patch) => updateRecord(state, id, patch),
    getAll: () => (state.disposed ? [] : [...state.records]),
    getForHref: (href) =>
      state.disposed ? [] : state.records.filter((record) => record.target.href === href),
    persist: () => persistRecords(state),
    onChange(cb) {
      if (state.disposed) return () => undefined;
      state.listeners.add(cb);
      return () => state.listeners.delete(cb);
    },
    dispose: () => {
      disposeStore(state);
    },
  };
}

function notify(state: StoreState): void {
  if (state.disposed) return;
  const snapshot = [...state.records];
  for (const cb of state.listeners) cb(snapshot);
}

function initFromAdapter(state: StoreState, adapter?: RecordStorageAdapter): Promise<void> {
  if (state.disposed) return Promise.resolve();
  const generation = ++state.generation;
  const previous = state.initialization;
  state.adapter = adapter;
  state.initialization = undefined;
  if (!adapter) {
    previous?.supersede();
    return Promise.resolve();
  }

  const load = beginAdapterLoad(adapter);
  const pending = createPendingInitialization(generation, adapter, load, previous?.mutations ?? []);
  state.initialization = pending;
  previous?.supersede(pending);
  pending.promise = loadAndInstallRecords(state, pending, adapter);
  return pending.promise;
}

async function loadAndInstallRecords(
  state: StoreState,
  pending: PendingInitialization,
  adapter: RecordStorageAdapter,
): Promise<void> {
  try {
    const outcome = await Promise.race([
      pending.load.then((records) => ({ status: 'loaded', records }) as const),
      pending.superseded.then(() => ({ status: 'superseded' }) as const),
    ]);
    if (outcome.status === 'superseded') return;
    if (!isCurrentInitialization(state, pending, adapter)) return;
    state.records = applyStoreMutations(outcome.records, pending.mutations);
    notify(state);
  } finally {
    if (state.initialization === pending) state.initialization = undefined;
  }
}

function persistRecords(state: StoreState): Promise<void> {
  if (state.disposed) return Promise.resolve();
  const snapshot = capturePersistenceSnapshot(state);
  const persist = state.persistTail.then(
    () => savePersistenceSnapshot(snapshot),
    () => savePersistenceSnapshot(snapshot),
  );
  state.persistTail = persist.catch(() => undefined);
  return persist;
}

function capturePersistenceSnapshot(
  state: StoreState,
  mutations?: readonly StoreMutation[],
): CapturedPersistence {
  const adapter = state.adapter;
  if (!adapter) return undefined;
  const pending = state.initialization;
  if (!pending) return { adapter, records: [...state.records] };
  return resolvePendingPersistence(state, pending, mutations ?? [...pending.mutations]);
}

async function resolvePendingPersistence(
  state: StoreState,
  pending: PendingInitialization,
  mutations: readonly StoreMutation[],
): Promise<PersistenceSnapshot | undefined> {
  const outcome = await Promise.race([
    pending.load.then((records) => ({ status: 'loaded', records }) as const),
    pending.superseded.then((successor) => ({ status: 'superseded', successor }) as const),
  ]);
  if (outcome.status === 'loaded') {
    return { adapter: pending.adapter, records: applyStoreMutations(outcome.records, mutations) };
  }
  if (outcome.successor) return resolvePendingPersistence(state, outcome.successor, mutations);
  if (!state.disposed) return capturePersistenceSnapshot(state, mutations);
  const records = await pending.load;
  return {
    adapter: pending.adapter,
    records: applyStoreMutations(records, mutations),
  };
}

async function savePersistenceSnapshot(snapshot: CapturedPersistence): Promise<void> {
  if (snapshot instanceof Promise) {
    const captured = await snapshot;
    if (captured) await captured.adapter.save(captured.records);
    return;
  }
  if (snapshot) await snapshot.adapter.save(snapshot.records);
}

function beginAdapterLoad(adapter: RecordStorageAdapter): Promise<readonly AnnotationRecord[]> {
  return Promise.resolve().then(() => adapter.load());
}

function addRecord(state: StoreState, draft: AnnotationDraft): AnnotationRecord {
  requireLiveStore(state);
  const record: AnnotationRecord = {
    id: `${state.idPrefix}-${(state.nextId++).toString()}`,
    kind: draft.kind,
    target: draft.target,
    createdAt: Date.now(),
    ...(draft.color !== undefined ? { color: draft.color } : {}),
    ...(draft.note !== undefined ? { note: draft.note } : {}),
  };
  state.records.push(record);
  state.initialization?.mutations.push({ type: 'add', record });
  notify(state);
  return record;
}

function removeRecord(state: StoreState, id: string): boolean {
  if (state.disposed) return false;
  const idx = state.records.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  state.records.splice(idx, 1);
  state.initialization?.mutations.push({ type: 'remove', id });
  notify(state);
  return true;
}

function updateRecord(state: StoreState, id: string, patch: AnnotationRecordPatch): boolean {
  if (state.disposed) return false;
  const idx = state.records.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  const existing = state.records[idx];
  if (!existing) return false;
  const modifiedAt = Date.now();
  state.records[idx] = {
    ...existing,
    modifiedAt,
    ...(patch.color !== undefined ? { color: patch.color } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
  };
  state.initialization?.mutations.push({ type: 'update', id, patch, modifiedAt });
  notify(state);
  return true;
}

function disposeStore(state: StoreState): void {
  if (state.disposed) return;
  state.disposed = true;
  state.generation += 1;
  state.initialization?.supersede();
  state.adapter = undefined;
  state.initialization = undefined;
  state.records = [];
  state.listeners.clear();
}

function requireLiveStore(state: StoreState): void {
  if (state.disposed) throw new Error('Cannot modify a disposed annotation store');
}

function isCurrentInitialization(
  state: StoreState,
  pending: PendingInitialization,
  adapter: RecordStorageAdapter,
): boolean {
  return (
    !state.disposed &&
    state.generation === pending.generation &&
    state.initialization === pending &&
    state.adapter === adapter
  );
}

function createIdPrefix(): string {
  const runtime = globalThis as unknown as {
    readonly crypto?: { readonly randomUUID?: () => string };
  };
  const uuid = runtime.crypto?.randomUUID?.();
  if (uuid !== undefined && uuid.length > 0) return `annotation-${uuid}`;
  fallbackStoreSequence += 1;
  return `annotation-${Date.now().toString(36)}-${fallbackStoreSequence.toString(36)}`;
}

function createPendingInitialization(
  generation: number,
  adapter: RecordStorageAdapter,
  load: Promise<readonly AnnotationRecord[]>,
  mutations: readonly StoreMutation[],
): PendingInitialization {
  let supersede = (_successor?: PendingInitialization): void => undefined;
  const superseded = new Promise<PendingInitialization | undefined>((resolve) => {
    supersede = resolve;
  });
  return {
    generation,
    adapter,
    load,
    mutations: [...mutations],
    superseded,
    supersede,
    promise: Promise.resolve(),
  };
}
