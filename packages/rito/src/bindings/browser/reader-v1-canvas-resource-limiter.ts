interface QueuedPrepareTask {
  run(): void;
  reject(reason: unknown): void;
}

/** One owner-wide cap shared by every overlapping artifact preparation. */
export class BrowserReaderCanvasResourceLimiterV1 {
  private readonly queue: QueuedPrepareTask[] = [];
  private active = 0;
  private disposed = false;
  private disposeReason: unknown;

  constructor(private readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 4) {
      throw new RangeError('Reader v1 Canvas resource concurrency must be between one and four.');
    }
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    if (this.disposed) return Promise.reject(this.disposeError());
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        reject,
        run: () => {
          Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => {
              this.active -= 1;
              this.drain();
            });
        },
      });
      this.drain();
    });
  }

  dispose(reason: unknown): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeReason = reason;
    const error = this.disposeError();
    for (const queued of this.queue.splice(0)) queued.reject(error);
  }

  private disposeError(): Error {
    return this.disposeReason instanceof Error
      ? this.disposeReason
      : new Error('Reader v1 Canvas resource limiter is disposed.', {
          cause: this.disposeReason,
        });
  }

  private drain(): void {
    while (!this.disposed && this.active < this.limit) {
      const queued = this.queue.shift();
      if (!queued) return;
      this.active += 1;
      queued.run();
    }
  }
}

export async function settleCanvasResourcesWithLimiterV1<Input, Output>(
  values: readonly Input[],
  limiter: BrowserReaderCanvasResourceLimiterV1,
  task: (value: Input) => Promise<Output>,
): Promise<PromiseSettledResult<Output>[]> {
  return Promise.all(
    values.map((value) =>
      limiter
        .run(() => task(value))
        .then(
          (result): PromiseFulfilledResult<Output> => ({ status: 'fulfilled', value: result }),
          (reason: unknown): PromiseRejectedResult => ({ status: 'rejected', reason }),
        ),
    ),
  );
}
