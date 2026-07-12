import { validateReaderWorkerOpenResult } from './reader-worker-pinned-font-runtime.js';

export function createReaderSessionState() {
  return {
    corePromise: undefined,
    document: undefined,
    phase: 'idle',
  };
}

export async function openReaderSessionDocument(state, initialize, open, label) {
  if (state.phase !== 'idle') {
    throw new Error(`${label} cannot open while ${state.phase}`);
  }
  state.phase = 'opening';
  let candidate;
  try {
    const core = await initializedCore(state, initialize);
    if (state.phase !== 'opening') {
      throw new Error(`${label} was disposed while opening`);
    }
    candidate = core.openDocument(new Uint8Array(open.data), open.options);
    const publication = candidate.publication();
    const pinnedFontPolicy = candidate.pinnedFontPolicy();
    const result = validateReaderWorkerOpenResult(
      { publication, pinnedFontPolicy },
      open.expectedFaces,
    );
    if (state.phase !== 'opening') {
      throw new Error(`${label} was disposed while opening`);
    }
    state.document = candidate;
    candidate = undefined;
    state.phase = 'open';
    return { kind: 'open', result };
  } catch (error) {
    try {
      candidate?.free();
    } catch {
      // Preserve the open failure; the candidate is never committed to state.
    }
    if (state.phase === 'opening') state.phase = 'idle';
    throw error;
  }
}

export function disposeReaderSession(state) {
  if (state.phase === 'disposed') return;
  state.phase = 'disposed';
  const document = state.document;
  state.document = undefined;
  document?.free();
}

async function initializedCore(state, initialize) {
  state.corePromise ??= initialize();
  const pending = state.corePromise;
  try {
    return await pending;
  } catch (error) {
    if (state.corePromise === pending) state.corePromise = undefined;
    throw error;
  }
}
