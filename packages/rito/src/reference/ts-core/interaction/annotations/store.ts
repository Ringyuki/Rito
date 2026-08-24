/**
 * AnnotationStore — source-anchored annotation persistence.
 * Replaces AnnotationEngine for the new annotation model.
 * No pageIndex, no TextRange — those are runtime concerns.
 */

import type { AnnotationRecord, AnnotationDraft, AnnotationRecordPatch } from './model';

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
}

interface StoreState {
  records: AnnotationRecord[];
  adapter: RecordStorageAdapter | undefined;
  nextId: number;
  listeners: Set<(r: readonly AnnotationRecord[]) => void>;
}

export function createAnnotationStore(): AnnotationStore {
  const state: StoreState = {
    records: [],
    adapter: undefined,
    nextId: 1,
    listeners: new Set(),
  };

  return {
    init: (adapter) => initFromAdapter(state, adapter),
    add: (draft) => addRecord(state, draft),
    remove: (id) => removeRecord(state, id),
    update: (id, patch) => updateRecord(state, id, patch),
    getAll: () => [...state.records],
    getForHref: (href) => state.records.filter((r) => r.target.href === href),
    persist: async () => {
      if (state.adapter) await state.adapter.save(state.records);
    },
    onChange(cb) {
      state.listeners.add(cb);
      return () => state.listeners.delete(cb);
    },
  };
}

function notify(state: StoreState): void {
  const snapshot = [...state.records];
  for (const cb of state.listeners) cb(snapshot);
}

async function initFromAdapter(state: StoreState, adapter?: RecordStorageAdapter): Promise<void> {
  state.adapter = adapter;
  if (!adapter) return;
  const loaded = await adapter.load();
  state.records = [...loaded];
  for (const r of state.records) {
    const n = parseInt(r.id, 10);
    if (!isNaN(n) && n >= state.nextId) state.nextId = n + 1;
  }
  notify(state);
}

function addRecord(state: StoreState, draft: AnnotationDraft): AnnotationRecord {
  const record: AnnotationRecord = {
    id: String(state.nextId++),
    kind: draft.kind,
    target: draft.target,
    createdAt: Date.now(),
    ...(draft.color !== undefined ? { color: draft.color } : {}),
    ...(draft.note !== undefined ? { note: draft.note } : {}),
  };
  state.records.push(record);
  notify(state);
  return record;
}

function removeRecord(state: StoreState, id: string): boolean {
  const idx = state.records.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  state.records.splice(idx, 1);
  notify(state);
  return true;
}

function updateRecord(state: StoreState, id: string, patch: AnnotationRecordPatch): boolean {
  const idx = state.records.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  const existing = state.records[idx];
  if (!existing) return false;
  state.records[idx] = {
    ...existing,
    modifiedAt: Date.now(),
    ...(patch.color !== undefined ? { color: patch.color } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
  };
  notify(state);
  return true;
}
