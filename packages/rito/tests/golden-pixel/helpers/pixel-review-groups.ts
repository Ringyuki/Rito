import type { PixelReviewRecord, PixelReviewStatus } from './pixel-review';

export interface BookReviewGroup {
  readonly bookId: string;
  readonly records: readonly PixelReviewRecord[];
  readonly runs: readonly RunReviewGroup[];
  readonly problemCount: number;
}

export interface RunReviewGroup {
  readonly runId: string;
  readonly profileId: string;
  readonly lineBreaking: string;
  readonly records: readonly PixelReviewRecord[];
  readonly problemCount: number;
}

export interface SelectedReviewGroup {
  readonly bookId: string | undefined;
  readonly runId: string | undefined;
}

const REVIEW_STATUS_ORDER: readonly PixelReviewStatus[] = [
  'fail',
  'error',
  'missing',
  'warn',
  'pass',
];

export function groupRecordsByBook(
  records: readonly PixelReviewRecord[],
): readonly BookReviewGroup[] {
  const groups = new Map<string, PixelReviewRecord[]>();
  for (const record of records) {
    const group = groups.get(record.bookId) ?? [];
    group.push(record);
    groups.set(record.bookId, group);
  }
  return [...groups.entries()]
    .map(([bookId, groupRecords]) => ({
      bookId,
      records: groupRecords,
      runs: groupRecordsByRun(groupRecords),
      problemCount: groupRecords.filter(isProblemRecord).length,
    }))
    .sort(compareBookGroups);
}

export function initialSelectedGroup(groups: readonly BookReviewGroup[]): SelectedReviewGroup {
  const problemBook = groups.find((group) => group.problemCount > 0);
  const book = problemBook ?? groups[0];
  const problemRun = book?.runs.find((run) => run.problemCount > 0);
  const run = problemRun ?? book?.runs[0];
  return { bookId: book?.bookId, runId: run?.runId };
}

export function isProblemRecord(record: PixelReviewRecord): boolean {
  return record.status !== 'pass';
}

export function summaryText(records: readonly PixelReviewRecord[]): string {
  const counts = new Map<PixelReviewStatus, number>();
  for (const record of records) counts.set(record.status, (counts.get(record.status) ?? 0) + 1);
  return REVIEW_STATUS_ORDER.map((status) => `${status}: ${String(counts.get(status) ?? 0)}`).join(
    ' / ',
  );
}

function groupRecordsByRun(records: readonly PixelReviewRecord[]): readonly RunReviewGroup[] {
  const groups = new Map<string, PixelReviewRecord[]>();
  for (const record of records) {
    const group = groups.get(record.runId) ?? [];
    group.push(record);
    groups.set(record.runId, group);
  }
  return [...groups.entries()]
    .map(([runId, groupRecords]) => ({
      runId,
      profileId: groupRecords[0]?.profileId ?? '',
      lineBreaking: groupRecords[0]?.lineBreaking ?? '',
      records: groupRecords,
      problemCount: groupRecords.filter(isProblemRecord).length,
    }))
    .sort(compareRunGroups);
}

function compareBookGroups(left: BookReviewGroup, right: BookReviewGroup): number {
  return left.bookId.localeCompare(right.bookId);
}

function compareRunGroups(left: RunReviewGroup, right: RunReviewGroup): number {
  const profileOrder = left.profileId.localeCompare(right.profileId);
  if (profileOrder !== 0) return profileOrder;
  return left.lineBreaking.localeCompare(right.lineBreaking);
}
