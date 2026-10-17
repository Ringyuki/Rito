import type { AnnotationRecord, AnnotationRecordPatch } from './model';

export type StoreMutation =
  | { readonly type: 'add'; readonly record: AnnotationRecord }
  | { readonly type: 'insert'; readonly record: AnnotationRecord }
  | { readonly type: 'remove'; readonly id: string }
  | {
      readonly type: 'update';
      readonly id: string;
      readonly patch: AnnotationRecordPatch;
      readonly modifiedAt: number;
    };

export function applyStoreMutations(
  loaded: readonly AnnotationRecord[],
  mutations: readonly StoreMutation[],
): AnnotationRecord[] {
  const records = deduplicateRecords(loaded);
  for (const mutation of mutations) applyMutation(records, mutation);
  return records;
}

function applyMutation(records: AnnotationRecord[], mutation: StoreMutation): void {
  const index = records.findIndex((record) => record.id === mutationId(mutation));
  if (mutation.type === 'remove') {
    if (index !== -1) records.splice(index, 1);
  } else if (mutation.type === 'add') {
    if (index === -1) records.push(mutation.record);
    else records[index] = mutation.record;
  } else if (mutation.type === 'insert') {
    placeRecord(records, mutation.record);
  } else if (index !== -1) {
    const existing = records[index];
    if (existing) records[index] = applyRecordPatch(existing, mutation);
  }
}

function deduplicateRecords(records: readonly AnnotationRecord[]): AnnotationRecord[] {
  const result: AnnotationRecord[] = [];
  const indices = new Map<string, number>();
  for (const record of records) {
    const index = indices.get(record.id);
    if (index === undefined) {
      indices.set(record.id, result.length);
      result.push(record);
    } else {
      result[index] = record;
    }
  }
  return result;
}

/**
 * Puts a whole record back: over the record with its id, where that one
 * stands, or else before the first record created after it. Records are
 * kept in creation order, which is also their paint order, so a deleted
 * record put back returns to its place under and over its neighbours.
 */
export function placeRecord(records: AnnotationRecord[], record: AnnotationRecord): void {
  const same = records.findIndex((existing) => existing.id === record.id);
  if (same !== -1) {
    records[same] = record;
    return;
  }
  const later = records.findIndex((existing) => existing.createdAt > record.createdAt);
  records.splice(later === -1 ? records.length : later, 0, record);
}

function mutationId(mutation: StoreMutation): string {
  return mutation.type === 'add' || mutation.type === 'insert' ? mutation.record.id : mutation.id;
}

function applyRecordPatch(
  record: AnnotationRecord,
  mutation: Extract<StoreMutation, { readonly type: 'update' }>,
): AnnotationRecord {
  return {
    ...record,
    modifiedAt: mutation.modifiedAt,
    ...(mutation.patch.color !== undefined ? { color: mutation.patch.color } : {}),
    ...(mutation.patch.note !== undefined ? { note: mutation.patch.note } : {}),
  };
}
