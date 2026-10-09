import type {
  Reader,
  ReaderLocator,
  ReaderLocatorMatchedBy,
  ReaderLocatorResolution,
  TocEntry,
} from '../../../reader';
import { RitoReaderError, type BrowserReaderLocator } from '../reader-session';
import { waitForSessionReaderBook } from './commit';
import { sessionReaderClosed, type SessionReaderState } from './state';

const MATCHED_BY = {
  'source-range': 'sourceRange',
  'source-point': 'sourcePoint',
  anchor: 'anchor',
  progression: 'progression',
  href: 'href',
} as const satisfies Record<string, ReaderLocatorMatchedBy>;

export function sessionReaderNavigationMethods(
  state: SessionReaderState,
): Pick<
  Reader,
  'findPage' | 'findSpread' | 'resolveTocEntry' | 'findActiveTocEntry' | 'navigateToLocator'
> {
  const tocPage = (entry: TocEntry): number | undefined => {
    const tocId = state.publication.tocId(entry);
    return tocId === undefined ? undefined : state.view.tocPageById.get(tocId);
  };
  return {
    findPage: tocPage,
    findSpread: (pageIndex) => state.view.spreadIndexByPage[pageIndex],
    resolveTocEntry(entry) {
      const pageIndex = tocPage(entry);
      const spreadIndex =
        pageIndex === undefined ? undefined : state.view.spreadIndexByPage[pageIndex];
      return pageIndex === undefined || spreadIndex === undefined
        ? undefined
        : { pageIndex, spreadIndex };
    },
    findActiveTocEntry(pageIndex) {
      const tocId = state.view.activeTocIdByPage[pageIndex];
      return tocId === undefined ? undefined : state.publication.tocEntry(tocId);
    },
    navigateToLocator: (locator, signal) => locateSessionReaderLocator(state, locator, signal),
  };
}

/**
 * Where a locator lands in the committed layout. A chapter the committed
 * layout does not cover is laid out only with the whole book, so its
 * locator is answered once that is committed.
 */
export async function locateSessionReaderLocator(
  state: SessionReaderState,
  locator: ReaderLocator,
  signal?: AbortSignal,
): Promise<ReaderLocatorResolution | undefined> {
  const target = sessionLocator(locator);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (state.disposed || signal?.aborted) return undefined;
    const generation = state.layoutGeneration;
    let result;
    try {
      result = await state.session.navigation({
        kind: 'locate',
        artifactId: state.visible.artifact.artifactId,
        locator: target,
      });
    } catch (error) {
      // The layout was replaced under the question: ask the new one.
      if (generation !== state.layoutGeneration && isUnknownArtifact(error)) continue;
      throw error;
    }
    if (sessionReaderClosed(state) || signal?.aborted) return undefined;
    if (generation !== state.layoutGeneration || result.kind !== 'location') continue;
    const { location } = result;
    if (location.kind === 'page') {
      const spreadIndex = state.view.spreadIndexByPage[location.pageIndex];
      if (spreadIndex === undefined) return undefined;
      return {
        status: 'resolved',
        locator,
        spineIdref: spineIdref(state, target.href),
        pageIndex: location.pageIndex,
        spreadIndex,
        matchedBy: MATCHED_BY[location.matchedBy],
      };
    }
    if (location.kind === 'unavailable' || state.view.scope === 'book') return undefined;
    await waitForSessionReaderBook(state, signal);
  }
  return undefined;
}

/** A reader locator as the session takes it; an href may carry its anchor after `#`. */
export function sessionLocator(locator: ReaderLocator): BrowserReaderLocator {
  const fragment = locator.href.indexOf('#');
  const href = fragment < 0 ? locator.href : locator.href.slice(0, fragment);
  const anchorId =
    locator.anchorId ?? (fragment < 0 ? undefined : locator.href.slice(fragment + 1));
  const point = (value: { nodePath: readonly number[]; textOffset: number }) => ({
    nodePath: value.nodePath,
    textOffset: BigInt(value.textOffset),
  });
  return {
    href,
    ...(anchorId === undefined || anchorId === '' ? {} : { anchorId }),
    ...(locator.sourcePoint === undefined ? {} : { sourcePoint: point(locator.sourcePoint) }),
    ...(locator.sourceRange === undefined
      ? {}
      : {
          sourceRange: {
            start: point(locator.sourceRange.start),
            end: point(locator.sourceRange.end),
          },
        }),
    ...(locator.progression === undefined ? {} : { progression: locator.progression }),
  };
}

function spineIdref(state: SessionReaderState, href: string): string {
  const spineIndex = state.publication.spineIndexByHref.get(href);
  return (spineIndex === undefined ? undefined : state.publication.spineIdrefs[spineIndex]) ?? '';
}

function isUnknownArtifact(error: unknown): boolean {
  return error instanceof RitoReaderError && error.code === 'unknown-artifact';
}
