import assert from 'node:assert/strict';
import test from 'node:test';

import { createShardPrefetchLane } from '../src/shard-prefetch-lane-runtime.js';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('the lane supplies nearest first, one at a time, and only while no call is in flight', async () => {
  const supplied = [];
  let concurrent = 0;
  const gates = new Map();
  const lane = createShardPrefetchLane(async (shardId) => {
    concurrent += 1;
    assert.equal(concurrent, 1, 'one supply at a time');
    const gate = deferred();
    gates.set(shardId, gate);
    await gate.promise;
    supplied.push(shardId);
    concurrent -= 1;
  });

  const turn = deferred();
  const call = lane.around(() => turn.promise);
  lane.restart([3, 1, 2]);
  await settle();
  assert.equal(gates.size, 0, 'a call in flight holds the lane');

  turn.resolve('page');
  assert.equal(await call, 'page');
  await settle();
  assert.deepEqual([...gates.keys()], [3]);

  // A call that starts mid-supply waits behind that one supply only.
  const read = deferred();
  const reading = lane.around(() => read.promise);
  gates.get(3).resolve();
  await settle();
  assert.deepEqual(supplied, [3]);
  assert.deepEqual([...gates.keys()], [3], 'the lane waits for the read');
  read.resolve();
  await reading;
  await settle();
  gates.get(1).resolve();
  await settle();
  gates.get(2).resolve();
  await settle();
  assert.deepEqual(supplied, [3, 1, 2]);
});

test('the lane skips what a read supplied and offers a failed shard again on restart', async () => {
  const attempts = [];
  let failOnce = true;
  const lane = createShardPrefetchLane(async (shardId) => {
    attempts.push(shardId);
    if (shardId === 2 && failOnce) {
      failOnce = false;
      throw new Error('offline');
    }
  });
  lane.noteSupplied(1);
  lane.restart([1, 2, 3]);
  await settle();
  assert.deepEqual(attempts, [2, 3]);

  lane.restart([3, 2, 1]);
  await settle();
  assert.deepEqual(attempts, [2, 3, 2]);

  lane.stop();
  lane.restart([4]);
  await settle();
  assert.deepEqual(attempts, [2, 3, 2], 'a stopped lane supplies nothing');
});
