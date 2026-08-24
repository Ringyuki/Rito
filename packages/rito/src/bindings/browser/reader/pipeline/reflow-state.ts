import type { LayoutConfig } from '../../../../reader';
import type { BrowserReaderQueuedReflow, BrowserReaderState } from '../types';

type ReflowPolicy = Pick<BrowserReaderQueuedReflow, 'config' | 'spreadMode' | 'lineBreaking'>;

function reflowPolicyEqual(
  policy: ReflowPolicy,
  config: LayoutConfig,
  spreadMode: 'single' | 'double',
  lineBreaking: 'greedy' | 'optimal',
): boolean {
  return (
    JSON.stringify(policy.config) === JSON.stringify(config) &&
    policy.spreadMode === spreadMode &&
    policy.lineBreaking === lineBreaking
  );
}

export function reportReflowError(state: BrowserReaderState, error: unknown, label: string): Error {
  const wrapped =
    error instanceof Error
      ? new Error(`${label} failed: ${error.message}`, { cause: error })
      : new Error(`${label} failed`);
  state.reflow.lastError = wrapped;
  state.logger.error(`${label} failed`, wrapped);
  return wrapped;
}

export function scheduleReaderMicrotask(state: BrowserReaderState, task: () => void): void {
  if (state.reflow.microtaskScheduled) return;
  state.reflow.microtaskScheduled = true;
  const run = (): void => {
    state.reflow.microtaskScheduled = false;
    task();
  };
  if (typeof queueMicrotask === 'function') queueMicrotask(run);
  else void Promise.resolve().then(run);
}

export function isStaleReflow(
  state: BrowserReaderState,
  request: BrowserReaderQueuedReflow,
): boolean {
  return state.disposed || request.token !== state.reflow.token;
}

export function isNoOpReflow(
  state: BrowserReaderState,
  config: LayoutConfig,
  spreadMode: 'single' | 'double',
  lineBreaking: 'greedy' | 'optimal',
  force: boolean,
): boolean {
  const idle =
    !state.revisionBundle.revision.revisionId && !state.reflow.active && !state.reflow.queued;
  if (force || idle) return false;
  const policy = state.reflow.queued ?? state.reflow.active ?? state;
  return reflowPolicyEqual(policy, config, spreadMode, lineBreaking);
}
