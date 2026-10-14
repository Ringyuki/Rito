// Hands the host a turn between two steps of a continuation: the
// scheduler's task primitive where there is one, else a message task,
// else a timer.
export function defaultYieldControl() {
  const scheduler = globalThis.scheduler;
  if (typeof scheduler?.yield === 'function') {
    return scheduler.yield();
  }
  if (typeof globalThis.MessageChannel === 'function') {
    return new Promise((resolve) => {
      const channel = new globalThis.MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        channel.port2.close();
        resolve();
      };
      channel.port2.postMessage(undefined);
    });
  }
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}
