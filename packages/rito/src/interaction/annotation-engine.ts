/**
 * L1 AnnotationEngine — in-memory annotation store with pluggable persistence.
 */

import type { Annotation } from './annotations';
import type { TextRange } from './types';

export interface StorageAdapter {
  load(): Promise<readonly Annotation[]>;
  save(annotations: readonly Annotation[]): Promise<void>;
}

export interface AnnotationEngine {
  init(adapter?: StorageAdapter): Promise<void>;
  add(data: AnnotationInput): Annotation;
  remove(id: string): boolean;
  update(id: string, patch: AnnotationPatch): boolean;
  getForPage(pageIndex: number): readonly Annotation[];
  getAll(): readonly Annotation[];
  persist(): Promise<void>;
  onAnnotationsChange(cb: (annotations: readonly Annotation[]) => void): () => void;
}

export interface AnnotationInput {
  readonly type: 'highlight' | 'underline' | 'note';
  readonly range: TextRange;
  readonly pageIndex: number;
  readonly color?: string;
  readonly note?: string;
}

export interface AnnotationPatch {
  readonly color?: string;
  readonly note?: string;
}

interface AnnotationState {
  annotations: Annotation[];
  adapter: StorageAdapter | undefined;
  nextId: number;
  listeners: Set<(a: readonly Annotation[]) => void>;
}

export function createAnnotationEngine(): AnnotationEngine {
  const s: AnnotationState = {
    annotations: [],
    adapter: undefined,
    nextId: 1,
    listeners: new Set(),
  };
  return buildAnnotationApi(s);
}

function notify(s: AnnotationState): void {
  const snapshot = [...s.annotations];
  for (const cb of s.listeners) cb(snapshot);
}

function buildAnnotationApi(s: AnnotationState): AnnotationEngine {
  return {
    async init(storageAdapter) {
      s.adapter = storageAdapter;
      if (!s.adapter) return;
      const loaded = await s.adapter.load();
      s.annotations = [...loaded];
      for (const a of s.annotations) {
        const n = parseInt(a.id, 10);
        if (!isNaN(n) && n >= s.nextId) s.nextId = n + 1;
      }
      notify(s);
    },
    add: (data) => addAnnotation(s, data),
    remove: (id) => removeAnnotation(s, id),
    update: (id, patch) => updateAnnotation(s, id, patch),
    getForPage: (pageIndex) => s.annotations.filter((a) => a.pageIndex === pageIndex),
    getAll: () => [...s.annotations],
    async persist() {
      if (s.adapter) await s.adapter.save(s.annotations);
    },
    onAnnotationsChange(cb) {
      s.listeners.add(cb);
      return () => s.listeners.delete(cb);
    },
  };
}

function addAnnotation(s: AnnotationState, data: AnnotationInput): Annotation {
  const annotation: Annotation = {
    id: String(s.nextId++),
    type: data.type,
    range: data.range,
    pageIndex: data.pageIndex,
    createdAt: Date.now(),
    ...(data.color ? { color: data.color } : {}),
    ...(data.note ? { note: data.note } : {}),
  };
  s.annotations.push(annotation);
  notify(s);
  return annotation;
}

function removeAnnotation(s: AnnotationState, id: string): boolean {
  const idx = s.annotations.findIndex((a) => a.id === id);
  if (idx === -1) return false;
  s.annotations.splice(idx, 1);
  notify(s);
  return true;
}

function updateAnnotation(s: AnnotationState, id: string, patch: AnnotationPatch): boolean {
  const idx = s.annotations.findIndex((a) => a.id === id);
  if (idx === -1) return false;
  const existing = s.annotations[idx];
  if (!existing) return false;
  s.annotations[idx] = {
    ...existing,
    ...(patch.color !== undefined ? { color: patch.color } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
  };
  notify(s);
  return true;
}
