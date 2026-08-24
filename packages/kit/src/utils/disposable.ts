/** Collects cleanup functions and disposes them all at once. */
export interface DisposableCollection {
  add(dispose: () => void): void;
  disposeAll(): void;
}

export function createDisposableCollection(): DisposableCollection {
  const fns: (() => void)[] = [];

  return {
    add(dispose: () => void): void {
      fns.push(dispose);
    },
    disposeAll(): void {
      runDisposers(fns.splice(0));
    },
  };
}

/** Runs every disposer and rethrows the first failure after cleanup completes. */
export function runDisposers(disposers: readonly (() => void)[]): void {
  const errors: unknown[] = [];
  for (const dispose of disposers) {
    try {
      dispose();
    } catch (error: unknown) {
      errors.push(error);
    }
  }
  if (errors.length > 0) throw errors[0];
}
