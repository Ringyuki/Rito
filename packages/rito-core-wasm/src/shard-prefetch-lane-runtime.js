/**
 * Supplies a sharded publication's content shards ahead of need, so an
 * image is in the engine before a page draws it.
 *
 * The lane yields to the reader: it supplies one shard at a time, and only
 * while no other call is in flight, so a page turn or a read waits behind
 * at most the one supply already under way. A shard it fails to supply is
 * left for the read that needs it, which loads it again and reports the
 * failure; the next restart offers it once more.
 */
export function createShardPrefetchLane(supplyShard) {
  let queue = [];
  let busy = 0;
  let running = false;
  let stopped = false;
  const supplied = new Set();

  const pump = async () => {
    if (running) return;
    running = true;
    try {
      while (!stopped && busy === 0 && queue.length > 0) {
        const shardId = queue.shift();
        if (supplied.has(shardId)) continue;
        supplied.add(shardId);
        try {
          await supplyShard(shardId);
        } catch {
          supplied.delete(shardId);
        }
      }
    } finally {
      running = false;
    }
  };

  return {
    /** Runs one reader call; the lane pauses until no call is in flight. */
    async around(run) {
      busy += 1;
      try {
        return await run();
      } finally {
        busy -= 1;
        if (busy === 0) void pump();
      }
    },
    /** Replaces the queue with `order`, nearest first. */
    restart(order) {
      queue = order.filter((shardId) => !supplied.has(shardId));
      void pump();
    },
    /** Records a shard a read supplied, so the lane does not supply it again. */
    noteSupplied(shardId) {
      supplied.add(shardId);
    },
    stop() {
      stopped = true;
      queue = [];
    },
  };
}
