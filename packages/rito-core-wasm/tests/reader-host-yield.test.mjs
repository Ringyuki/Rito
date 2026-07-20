import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultYieldControl } from '../src/reader-bounded-session-support-runtime.js';

test('default Reader continuation yield resumes on a later host task', async () => {
  let synchronous = true;
  const yielded = defaultYieldControl().then(() => {
    assert.equal(synchronous, false);
  });

  synchronous = false;
  await yielded;
});

test('default Reader continuation yield prefers the scheduler task primitive', async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'scheduler');
  if (descriptor && !descriptor.configurable) {
    t.skip('global scheduler is not configurable in this runtime');
    return;
  }
  t.after(() => restoreGlobal('scheduler', descriptor));
  let calls = 0;
  Object.defineProperty(globalThis, 'scheduler', {
    configurable: true,
    value: {
      yield() {
        calls += 1;
        return Promise.resolve();
      },
    },
  });

  await defaultYieldControl();

  assert.equal(calls, 1);
});

test('default Reader continuation yield uses MessageChannel before timers', async (t) => {
  const schedulerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'scheduler');
  const channelDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'MessageChannel');
  if (
    (schedulerDescriptor && !schedulerDescriptor.configurable) ||
    (channelDescriptor && !channelDescriptor.configurable)
  ) {
    t.skip('task globals are not configurable in this runtime');
    return;
  }
  t.after(() => {
    restoreGlobal('scheduler', schedulerDescriptor);
    restoreGlobal('MessageChannel', channelDescriptor);
  });
  let channels = 0;
  Object.defineProperty(globalThis, 'scheduler', {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(globalThis, 'MessageChannel', {
    configurable: true,
    value: class TestMessageChannel {
      port1 = { close() {}, onmessage: undefined };
      port2 = {
        close() {},
        postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
      };

      constructor() {
        channels += 1;
      }
    },
  });

  await defaultYieldControl();

  assert.equal(channels, 1);
});

function restoreGlobal(name, descriptor) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else Reflect.deleteProperty(globalThis, name);
}
