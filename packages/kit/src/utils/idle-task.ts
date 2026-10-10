/**
 * Runs `callback` when the main thread has nothing more urgent to do and
 * returns a function that cancels it. `eager` shortens the wait where the
 * browser offers only a deadline or a timer.
 */
export function scheduleIdleTask(callback: () => void, eager = false): () => void {
  const backgroundScheduler = getBackgroundTaskScheduler();
  if (backgroundScheduler) {
    const controller = new AbortController();
    void backgroundScheduler
      .postTask(callback, { priority: 'background', signal: controller.signal })
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }
  if (typeof requestIdleCallback === 'function' && typeof cancelIdleCallback === 'function') {
    const id = requestIdleCallback(callback, { timeout: eager ? 25 : 50 });
    return () => {
      cancelIdleCallback(id);
    };
  }
  if (typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function') {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(callback, 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (timer !== undefined) clearTimeout(timer);
    };
  }
  const id = setTimeout(callback, eager ? 16 : 50);
  return () => {
    clearTimeout(id);
  };
}

/**
 * Runs `callback` as an idle task once the next frame has been produced, so
 * work nobody sees never stands between a change and the frame that shows
 * it. Returns a function that cancels it.
 */
export function scheduleAfterNextFrame(callback: () => void): () => void {
  if (typeof requestAnimationFrame !== 'function' || typeof cancelAnimationFrame !== 'function') {
    return scheduleIdleTask(callback);
  }
  let cancelTask: (() => void) | undefined;
  const frame = requestAnimationFrame(() => {
    cancelTask = scheduleIdleTask(callback);
  });
  return () => {
    cancelAnimationFrame(frame);
    cancelTask?.();
  };
}

interface BackgroundTaskScheduler {
  postTask(
    callback: () => void,
    options: { readonly priority: 'background'; readonly signal: AbortSignal },
  ): Promise<void>;
}

function getBackgroundTaskScheduler(): BackgroundTaskScheduler | undefined {
  const scheduler = (globalThis as unknown as { scheduler?: BackgroundTaskScheduler }).scheduler;
  return typeof scheduler?.postTask === 'function' ? scheduler : undefined;
}
