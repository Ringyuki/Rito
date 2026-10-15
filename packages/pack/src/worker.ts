// The worker one call runs in: it instantiates the pack module, does the
// task, posts the one reply and exits, so the module's memory goes with the
// thread instead of staying behind in the caller's process.

import { webcrypto } from 'node:crypto';
import { parentPort, workerData } from 'node:worker_threads';

import {
  checkPublication,
  initSync,
  packPublication,
  type PackedPublication as WasmPackedPublication,
  type PublicationCheck as WasmPublicationCheck,
} from '@ritojs/core-wasm/pack';

import type { TaskResult, WorkerReply, WorkerTask } from './task';
import type { PackedPublication, PackedShard, PublicationCheck } from './types';

const port = parentPort;
if (port === null) throw new Error('The pack worker runs only as a worker thread');
const task = workerData as WorkerTask;

let reply: WorkerReply;
try {
  initSync({ module: task.module });
  reply = { ok: true, result: run(task) };
} catch (error) {
  reply = { ok: false, message: error instanceof Error ? error.message : String(error) };
}
port.postMessage(reply, reply.ok ? transferables(reply.result) : []);

function run(task: WorkerTask): TaskResult {
  if (task.kind === 'check') {
    const check = checkPublication(task.epub);
    try {
      return { kind: 'check', value: verdict(check) };
    } finally {
      check.free();
    }
  }
  const packed = packPublication(task.epub, task.encrypt, (buffer: Uint8Array<ArrayBuffer>) => {
    webcrypto.getRandomValues(buffer);
  });
  try {
    return { kind: 'pack', value: publication(packed) };
  } finally {
    packed.free();
  }
}

function publication(packed: WasmPackedPublication): PackedPublication {
  const [skeleton, ...shards] = Array.from({ length: packed.shardCount }, (_, index) =>
    shard(packed, index),
  );
  if (skeleton === undefined) throw new Error('A packed publication has no skeleton');
  return {
    bookId: Buffer.from(packed.bookId).toString('hex'),
    formatVersion: packed.formatVersion,
    encrypted: skeleton.key !== undefined,
    skeleton,
    shards,
  };
}

function shard(packed: WasmPackedPublication, index: number): PackedShard {
  const key = packed.shardKey(index);
  return {
    id: packed.shardId(index),
    bytes: packed.shardBytes(index),
    ...(key === undefined ? {} : { key }),
    files: packed.shardFiles(index),
  };
}

function verdict(check: WasmPublicationCheck): PublicationCheck {
  const error = check.error;
  if (error !== undefined) return { readable: false, error };
  const problems = Array.from({ length: check.problemCount }, (_, index) => ({
    path: check.problemPath(index),
    message: check.problemMessage(index),
  }));
  return { readable: true, problems };
}

/** The shard bytes move to the caller's thread instead of being copied. */
function transferables(result: TaskResult): ArrayBuffer[] {
  if (result.kind === 'check') return [];
  return [result.value.skeleton, ...result.value.shards]
    .map((packed) => packed.bytes.buffer)
    .filter((buffer) => buffer instanceof ArrayBuffer);
}
