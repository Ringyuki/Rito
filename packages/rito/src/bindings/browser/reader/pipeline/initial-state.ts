import { createBrowserReaderInteractionState } from '../interaction';
import type { BrowserReaderState } from '../types';

export function createEmptyBrowserReaderRevisionState(): Pick<
  BrowserReaderState,
  | 'revisionBundle'
  | 'revisionHandle'
  | 'commitGeneration'
  | 'boundedSessions'
  | 'disposeTask'
  | 'interaction'
> {
  return {
    revisionBundle: emptyRevisionBundle(),
    revisionHandle: undefined,
    commitGeneration: 0,
    boundedSessions: { current: undefined, candidate: undefined },
    disposeTask: undefined,
    interaction: createBrowserReaderInteractionState(),
  };
}

export function createEmptyBrowserReaderReflowState(): BrowserReaderState['reflow'] {
  return {
    active: undefined,
    token: 0,
    microtaskScheduled: false,
    queued: undefined,
    deferred: undefined,
    deferredTimer: undefined,
    locatorNavigation: undefined,
    lastError: undefined,
  };
}

function emptyRevisionBundle(): BrowserReaderState['revisionBundle'] {
  return {
    revision: {
      revisionId: '',
      revisionVersion: 0,
      layoutKey: '',
      status: 'complete',
      knownExtent: { pageCount: 0, spreadCount: 0 },
      finalExtent: { pageCount: 0, spreadCount: 0 },
      pageCount: 0,
      spreadCount: 0,
    },
    navigation: {
      revisionId: '',
      pageCount: 0,
      spreadCount: 0,
      spreads: [],
      chapters: [],
      chapterMap: {},
    },
    tocTargets: { revisionId: '', targets: [] },
    footnotes: { revisionId: '', entries: {} },
    chapterTextIndices: { revisionId: '', entries: {} },
    fontFamilies: [],
  };
}
