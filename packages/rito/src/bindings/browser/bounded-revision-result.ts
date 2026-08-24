import type {
  BrowserReaderBoundedSnapshot,
  BrowserReaderRevisionResult,
  CoreRevisionHandle,
} from './core-contracts';
import { selectedBrowserReaderBoundedSnapshotFrame } from './bounded-revision-snapshot';
import type { BrowserReaderBoundedSessionOwner } from './reader-session-host';

export async function createBrowserReaderBoundedRevisionResult(
  owner: BrowserReaderBoundedSessionOwner,
  snapshot: BrowserReaderBoundedSnapshot,
): Promise<BrowserReaderRevisionResult> {
  const handle = boundedSnapshotRevisionHandle(snapshot);
  const [footnotes, chapterTextIndices] = await Promise.all([
    owner.worker.getFootnotesAtRevision(handle),
    owner.worker.getChapterTextIndicesAtRevision(handle),
  ]);
  requireExactAggregate(footnotes, handle, footnotes.value.revisionId, 'footnotes');
  requireExactAggregate(
    chapterTextIndices,
    handle,
    chapterTextIndices.value.revisionId,
    'chapter text indices',
  );
  return resultWithSnapshotFrame(snapshot, {
    ...snapshot.presentation,
    footnotes: footnotes.value,
    chapterTextIndices: chapterTextIndices.value,
  });
}

export function boundedSnapshotRevisionHandle(
  snapshot: BrowserReaderBoundedSnapshot,
): CoreRevisionHandle {
  return {
    revisionId: snapshot.revision.revisionId,
    revisionVersion: snapshot.revision.revisionVersion,
  };
}

function resultWithSnapshotFrame(
  snapshot: BrowserReaderBoundedSnapshot,
  bundle: BrowserReaderRevisionResult['bundle'],
): BrowserReaderRevisionResult {
  const selectedFrame = selectedBrowserReaderBoundedSnapshotFrame(snapshot);
  return {
    bundle,
    ...(selectedFrame
      ? {
          frameSelection: {
            spreadIndex: selectedFrame.spreadIndex,
            displaySpreadIndex: selectedFrame.displaySpreadIndex,
          },
          selectedFrame,
        }
      : {}),
    ...(snapshot.frameWindow ? { frameWindow: snapshot.frameWindow } : {}),
    preview: false,
  };
}

function requireExactAggregate(
  response: { readonly revision: CoreRevisionHandle },
  expected: CoreRevisionHandle,
  valueRevisionId: string,
  label: string,
): void {
  if (
    response.revision.revisionId !== expected.revisionId ||
    response.revision.revisionVersion !== expected.revisionVersion ||
    valueRevisionId !== expected.revisionId
  ) {
    throw new Error(`Bounded reader ${label} do not match their exact revision`);
  }
}
