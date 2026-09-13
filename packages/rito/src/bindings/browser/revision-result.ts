import type {
  BrowserReaderRevisionSnapshot,
  BrowserReaderRevisionResult,
  CoreRevisionHandle,
} from './core-contracts';
import { selectedBrowserReaderRevisionSnapshotFrame } from './revision-snapshot';
import type { BrowserReaderRevisionSessionOwner } from './reader-session-host';

export async function createBrowserReaderRevisionResult(
  owner: BrowserReaderRevisionSessionOwner,
  snapshot: BrowserReaderRevisionSnapshot,
): Promise<BrowserReaderRevisionResult> {
  const handle = snapshotRevisionHandle(snapshot);
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

export function snapshotRevisionHandle(
  snapshot: BrowserReaderRevisionSnapshot,
): CoreRevisionHandle {
  return {
    revisionId: snapshot.revision.revisionId,
    revisionVersion: snapshot.revision.revisionVersion,
  };
}

function resultWithSnapshotFrame(
  snapshot: BrowserReaderRevisionSnapshot,
  bundle: BrowserReaderRevisionResult['bundle'],
): BrowserReaderRevisionResult {
  const selectedFrame = selectedBrowserReaderRevisionSnapshotFrame(snapshot);
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
    throw new Error(`Reader ${label} do not match their exact revision`);
  }
}
