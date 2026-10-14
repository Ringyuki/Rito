import type { FootnoteEntry, ReaderInteractions } from '../../../reader';
import { locateSessionReaderLocator } from './navigation';
import {
  sessionReaderPageReadingAnchor,
  sessionReaderPageSemantics,
  sessionReaderPageTargets,
} from './page-content';
import { askSessionReaderLayout, isSessionReaderError } from './page-space';
import { sessionReaderSourceInteractions } from './source-range';
import type { SessionReaderState } from './state';
import { createSessionReaderTextSelection } from './text-selection';

export function createSessionReaderInteractions(state: SessionReaderState): ReaderInteractions {
  return {
    get enabled() {
      return !state.disposed;
    },
    textSelection: createSessionReaderTextSelection(state),
    ...sessionReaderSourceInteractions(state),
    getPageSemantics: (pageIndex) => sessionReaderPageSemantics(state, pageIndex),
    getPageReadingAnchor: (pageIndex) => sessionReaderPageReadingAnchor(state, pageIndex),
    getPageTargets: (pageIndex) => sessionReaderPageTargets(state, pageIndex),
    getFootnote: (key) => readFootnote(state, key),
    resolveLocator: (locator) => locateSessionReaderLocator(state, locator),
  };
}

/**
 * The note a reference's key names. A note whose definition the engine has
 * not indexed yet has no content to show, which a reader says as undefined.
 */
async function readFootnote(
  state: SessionReaderState,
  key: string,
): Promise<FootnoteEntry | undefined> {
  try {
    const note = await askSessionReaderLayout(state, (capture) =>
      state.session.readFootnote(capture.artifactId, key),
    );
    return note && { kind: note.kind, text: note.text, html: note.html };
  } catch (error) {
    if (isSessionReaderError(error, 'target-not-published')) return undefined;
    throw error;
  }
}
