import type { Reader, ReaderSourcePoint, SearchResult } from '../../../reader';
import type { BrowserReaderSearchResponse } from '../reader-session';
import { waitForSessionReaderBook } from './commit';
import { scheduleSessionReaderRelayout } from './foreground';
import { askSessionReaderLayout, readerSourcePoint } from './page-space';
import { sessionReaderClosed, type SessionReaderState } from './state';

type SessionSearchResult = BrowserReaderSearchResponse['results'][number];

/** A layout replaced under a search is searched again, this many times at most. */
const SEARCH_ATTEMPTS = 4;

export function sessionReaderResourceMethods(
  state: SessionReaderState,
): Pick<
  Reader,
  | 'search'
  | 'getImageBlobUrl'
  | 'fonts'
  | 'unresolvedFontFamilies'
  | 'addFontFaces'
  | 'removeFontFaces'
> {
  return {
    search: (query, options) => search(state, query, options),
    getImageBlobUrl: (src) => imageObjectUrl(state, src),
    fonts: () => state.session.fonts(),
    unresolvedFontFamilies: (familyList) => state.session.unresolvedFontFamilies(familyList),
    async addFontFaces(faces) {
      await state.session.addFontFaces(faces);
      if (sessionReaderClosed(state)) return;
      state.hostFonts.add(faces);
      scheduleSessionReaderRelayout(state, true);
    },
    async removeFontFaces(sha256s) {
      await state.session.removeFontFaces(sha256s);
      if (sessionReaderClosed(state)) return;
      // The pages on screen were laid out with the faces: the page keeps
      // them registered until the layout without them is committed.
      const removed = [...sha256s];
      const forget = (): void => {
        state.layoutCommittedListeners.delete(forget);
        state.hostFonts.remove(removed);
      };
      state.layoutCommittedListeners.add(forget);
      scheduleSessionReaderRelayout(state, true);
    },
  };
}

/**
 * Searches the whole book. A reader that has only the chapter being read
 * laid out searches once the book is: results name book pages.
 */
async function search(
  state: SessionReaderState,
  query: string,
  options: Parameters<NonNullable<Reader['search']>>[1],
): Promise<readonly SearchResult[]> {
  if (query.length === 0) return [];
  for (let attempt = 0; attempt < SEARCH_ATTEMPTS; attempt += 1) {
    await waitForSessionReaderBook(state);
    if (sessionReaderClosed(state)) return [];
    if (state.view.scope !== 'book') continue;
    const response = await askSessionReaderLayout(state, (capture) =>
      state.session.search(capture.artifactId, {
        query,
        caseSensitive: options?.caseSensitive ?? false,
        wholeWord: options?.wholeWord ?? false,
      }),
    );
    if (response) return response.results.map(searchResult);
  }
  return [];
}

function searchResult(result: SessionSearchResult): SearchResult {
  const sourceRange = result.locator?.sourceRange;
  const point = (value: NonNullable<typeof sourceRange>['start']): ReaderSourcePoint =>
    readerSourcePoint(value);
  return {
    pageIndex: result.pageIndex,
    range: { start: { ...result.start }, end: { ...result.end } },
    context: result.context,
    source:
      result.locator === undefined || sourceRange === undefined
        ? { status: 'unavailable', reason: 'sourceUnavailable' }
        : {
            status: 'resolved',
            href: result.locator.href,
            sourceRange: { start: point(sourceRange.start), end: point(sourceRange.end) },
          },
  };
}

/**
 * An object URL for an image a held spread draws; the caller revokes it.
 * Undefined when no held spread draws the image or it cannot be read: a
 * reader still paints it from its own decoded copy.
 */
async function imageObjectUrl(state: SessionReaderState, src: string): Promise<string | undefined> {
  if (state.disposed || typeof URL === 'undefined') return undefined;
  const frame = [...state.frames.values()].find((held) =>
    held.artifact.resources.some((resource) => resource.kind === 'image' && resource.href === src),
  );
  if (!frame) return undefined;
  try {
    const resource = await state.session.readResource(frame.artifact.artifactId, 'image', src);
    if (sessionReaderClosed(state)) return undefined;
    const bytes = new Uint8Array(resource.bytes);
    return URL.createObjectURL(new Blob([bytes], { type: resource.mediaType }));
  } catch (error) {
    if (!sessionReaderClosed(state)) state.logger.warn('reader image could not be read', error);
    return undefined;
  }
}
