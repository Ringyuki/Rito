import { describe, expect, it } from 'vitest';
import { applyBrowserReaderRevisionState } from '../../src/bindings/browser/reader/revision';
import {
  createState,
  createWorker,
  revisionResult,
  setRevisionState,
} from './browser-reader-reflow-fixtures';

describe('Browser reader revision lifecycle', () => {
  it('releases the previous worker revision when revision ids collide', () => {
    const foreground = createWorker(() => undefined);
    const background = createWorker(() => undefined);
    const state = createState(foreground.worker);
    setRevisionState(state, revisionResult('rev-1', 1, 1).bundle.revision);
    const nextResult = revisionResult('rev-1', 1, 1);
    const previousHandle = state.revisionHandle;
    if (!previousHandle) throw new Error('test revision handle is missing');
    state.interaction.pageTargets.set(0, {
      revision: previousHandle,
      value: { pageIndex: 0, spreadIndex: 0, targets: [] },
    });
    state.interaction.pendingPageTargets.set(0, {
      revision: previousHandle,
      task: Promise.resolve(undefined),
    });
    const versionedResult = {
      ...nextResult,
      bundle: {
        ...nextResult.bundle,
        revision: { ...nextResult.bundle.revision, revisionVersion: 7 },
      },
    };

    applyBrowserReaderRevisionState(state, {
      config: state.config,
      spreadMode: state.spreadMode,
      lineBreaking: state.lineBreaking,
      result: versionedResult,
      worker: background.worker,
    });

    expect(foreground.releaseRevision).toHaveBeenCalledWith('rev-1');
    expect(state.revisionHandle).toEqual({
      workerSessionId: background.worker.sessionId,
      revisionId: 'rev-1',
      revisionVersion: 7,
      commitGeneration: 2,
    });
    expect(state.commitGeneration).toBe(2);
    expect(state.interaction.pageTargets.size).toBe(0);
    expect(state.interaction.pendingPageTargets.size).toBe(0);
  });
});
