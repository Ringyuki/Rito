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

    applyBrowserReaderRevisionState(state, {
      config: state.config,
      spreadMode: state.spreadMode,
      lineBreaking: state.lineBreaking,
      result: revisionResult('rev-1', 1, 1),
      worker: background.worker,
    });

    expect(foreground.releaseRevision).toHaveBeenCalledWith('rev-1');
  });
});
