import type { BrowserReaderState } from './reader/types';

const mutationTails = new WeakMap<BrowserReaderState, Promise<void>>();

export function enqueueBrowserReaderCurrentMutation<T>(
  state: BrowserReaderState,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = mutationTails.get(state) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(operation);
  mutationTails.set(
    state,
    task.then(
      () => undefined,
      () => undefined,
    ),
  );
  return task;
}
