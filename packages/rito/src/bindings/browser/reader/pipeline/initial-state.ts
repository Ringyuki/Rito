import { createBrowserReaderInteractionState } from '../interaction';
import type { BrowserReaderState } from '../types';

export function createEmptyBrowserReaderRevisionState(): Pick<
  BrowserReaderState,
  | 'revisionBundle'
  | 'revisionHandle'
  | 'commitGeneration'
  | 'revisionSessions'
  | 'disposeTask'
  | 'interaction'
  | 'pendingHostTasks'
> {
  return {
    revisionBundle: emptyRevisionBundle(),
    revisionHandle: undefined,
    commitGeneration: 0,
    revisionSessions: { current: undefined, candidate: undefined },
    disposeTask: undefined,
    interaction: createBrowserReaderInteractionState(),
    pendingHostTasks: new Set(),
  };
}

export function createEmptyBrowserReaderReflowState(): BrowserReaderState['reflow'] {
  return {
    active: undefined,
    token: 0,
    microtaskScheduled: false,
    queued: undefined,
    lastError: undefined,
  };
}

function emptyRevisionBundle(): BrowserReaderState['revisionBundle'] {
  return {
    revision: {
      revisionId: '',
      revisionVersion: 0,
      layoutKey: '',
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
    tocTargets: { revisionId: '', targets: [], activeEntryByPage: [] },
    footnotes: { revisionId: '', complete: false, pendingKeys: [], entries: {} },
    chapterTextIndices: { revisionId: '', entries: {} },
    fontFamilies: [],
  };
}
