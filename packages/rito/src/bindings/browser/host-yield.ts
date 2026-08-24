interface BrowserTaskScheduler {
  yield?: (() => Promise<void>) | undefined;
}

type BrowserTaskGlobal = {
  readonly scheduler?: BrowserTaskScheduler | undefined;
};

/** Yields continuation work without accumulating the nested-timer delay clamp. */
export function yieldBrowserHostTask(): Promise<void> {
  const scheduler = (globalThis as unknown as BrowserTaskGlobal).scheduler;
  if (typeof scheduler?.yield === 'function') return scheduler.yield();
  if (typeof globalThis.MessageChannel === 'function') return yieldWithMessageChannel();
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

function yieldWithMessageChannel(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(undefined);
  });
}
