import type { AnnotationRecord, AnnotationRecordPatch } from './model';

export type StoreMutation =
  | { readonly type: 'add'; readonly record: AnnotationRecord }
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

function mutationId(mutation: StoreMutation): string {
  return mutation.type === 'add' ? mutation.record.id : mutation.id;
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
