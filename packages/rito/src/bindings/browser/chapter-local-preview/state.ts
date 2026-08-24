import type { ReaderLocator, TocEntry } from '../../../reader';
import type { BrowserReaderState } from '../reader/types';
import type {
  BrowserReaderChapterLocalOwner,
  BrowserReaderChapterLocalPreviewActive,
  BrowserReaderChapterLocalPreviewRequest,
  BrowserReaderChapterLocalPreviewState,
} from './types';

interface ComparableReaderLocator {
  readonly href: string;
  readonly anchorId?: string | undefined;
  readonly sourcePoint?:
    | { readonly nodePath: readonly number[]; readonly textOffset: number }
    | undefined;
  readonly sourceRange?:
    | {
        readonly start: { readonly nodePath: readonly number[]; readonly textOffset: number };
        readonly end: { readonly nodePath: readonly number[]; readonly textOffset: number };
      }
    | undefined;
  readonly progression?: number | undefined;
}

export function createBrowserReaderChapterLocalPreviewState(
  initialLocator?: ReaderLocator,
): BrowserReaderChapterLocalPreviewState {
  return {
    nextRequestId: 0,
    latestRequestId: 0,
    active: undefined,
    initialLocator: initialLocator ? copyLocator(initialLocator) : undefined,
  };
}

export function activeBrowserReaderChapterLocalPreview(
  state: BrowserReaderState,
  spreadIndex?: number,
): BrowserReaderChapterLocalPreviewActive | undefined {
  const active = state.chapterLocalPreview.active;
  if (!active || active.request.id !== state.chapterLocalPreview.latestRequestId) return undefined;
  if (spreadIndex !== undefined && active.request.mountSpreadIndex !== spreadIndex)
    return undefined;
  return active;
}

export function browserReaderChapterLocalPreviewSuspendsInteractions(
  state: BrowserReaderState,
): boolean {
  return activeBrowserReaderChapterLocalPreview(state) !== undefined;
}

export function browserReaderChapterLocalPreviewTocEntry(
  state: BrowserReaderState,
): TocEntry | undefined {
  return activeBrowserReaderChapterLocalPreview(state)?.request.tocEntry;
}

export function ownsBrowserReaderChapterLocalPreviewRequest(
  state: BrowserReaderState,
  request: BrowserReaderChapterLocalPreviewRequest,
): boolean {
  return (
    !state.disposed &&
    !request.mainSettled &&
    request.id === state.chapterLocalPreview.latestRequestId &&
    request.workerSessionId === state.worker.sessionId &&
    request.spreadMode === state.spreadMode &&
    request.lineBreaking === state.lineBreaking
  );
}

export function sameBrowserReaderChapterLocalOwner(
  left: BrowserReaderChapterLocalOwner,
  right: BrowserReaderChapterLocalOwner,
): boolean {
  return (
    left.revisionId === right.revisionId &&
    left.revisionVersion === right.revisionVersion &&
    left.coordinate.chapterIndex === right.coordinate.chapterIndex &&
    left.coordinate.href === right.coordinate.href
  );
}

export function notifyBrowserReaderChapterLocalPreviewInvalidated(
  state: BrowserReaderState,
  spreadIndex: number,
): void {
  for (const listener of state.spreadContentInvalidatedListeners) {
    try {
      listener(spreadIndex);
    } catch (error) {
      try {
        state.logger.warn('reader chapter-local preview invalidation listener failed', error);
      } catch {
        // Invalidation notification is a noexcept ownership boundary.
      }
    }
  }
}

export function sameBrowserReaderLocator(
  left: ComparableReaderLocator,
  right: ComparableReaderLocator,
): boolean {
  return (
    JSON.stringify(canonicalizeBrowserReaderChapterLocalLocator(left)) ===
    JSON.stringify(canonicalizeBrowserReaderChapterLocalLocator(right))
  );
}

/** Normalize legacy `chapter#anchor` locators only for the bounded local path. */
export function canonicalizeBrowserReaderChapterLocalLocator(
  locator: ComparableReaderLocator,
): ReaderLocator {
  const copy = copyLocator(locator);
  const fragmentStart = copy.href.indexOf('#');
  if (fragmentStart < 0) return copy;
  const href = copy.href.slice(0, fragmentStart);
  const fragment = decodeLocatorFragment(copy.href.slice(fragmentStart + 1));
  return {
    ...copy,
    href,
    ...(copy.anchorId === undefined && fragment.length > 0 ? { anchorId: fragment } : {}),
  };
}

export function browserReaderChapterLocalLocatorHasAnchorConflict(
  locator: ComparableReaderLocator,
): boolean {
  const fragmentStart = locator.href.indexOf('#');
  if (fragmentStart < 0 || locator.anchorId === undefined) return false;
  const fragment = decodeLocatorFragment(locator.href.slice(fragmentStart + 1));
  return fragment.length > 0 && fragment !== locator.anchorId;
}

function decodeLocatorFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

function copyLocator(locator: ComparableReaderLocator): ReaderLocator {
  return {
    href: locator.href,
    ...(locator.anchorId !== undefined ? { anchorId: locator.anchorId } : {}),
    ...(locator.sourcePoint
      ? {
          sourcePoint: {
            nodePath: [...locator.sourcePoint.nodePath],
            textOffset: locator.sourcePoint.textOffset,
          },
        }
      : {}),
    ...(locator.sourceRange
      ? {
          sourceRange: {
            start: {
              nodePath: [...locator.sourceRange.start.nodePath],
              textOffset: locator.sourceRange.start.textOffset,
            },
            end: {
              nodePath: [...locator.sourceRange.end.nodePath],
              textOffset: locator.sourceRange.end.textOffset,
            },
          },
        }
      : {}),
    ...(locator.progression !== undefined ? { progression: locator.progression } : {}),
  };
}
