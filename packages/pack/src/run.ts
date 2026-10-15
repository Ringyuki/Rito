import { readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';

import type { TaskInput, TaskResult, WorkerReply, WorkerTask } from './task';

let compiled: Promise<WebAssembly.Module> | undefined;

/** The pack module, compiled once per process and shared with every worker. */
function packModule(): Promise<WebAssembly.Module> {
  compiled ??= readFile(new URL('./rito_pack_bg.wasm', import.meta.url))
    .then((bytes) => WebAssembly.compile(bytes))
    .catch((error: unknown) => {
      compiled = undefined;
      throw error;
    });
  return compiled;
}

/**
 * Runs one task on a worker thread of its own. Packing a large book takes
 * seconds of CPU, which would stall every other request on the caller's
 * thread; and the module's memory, which grows to several times the book
 * and never shrinks, is released when the worker exits.
 */
export async function runTask(input: TaskInput): Promise<TaskResult> {
  const task: WorkerTask = { ...input, module: await packModule() };
  return new Promise((resolve, reject) => {
    // The worker needs none of the host's Node flags, and some of them
    // (`--eval`, `--input-type`) make a worker fail to start.
    const worker = new Worker(new URL('./worker.mjs', import.meta.url), {
      workerData: task,
      execArgv: [],
    });
    let answered = false;
    worker.once('message', (reply: WorkerReply) => {
      answered = true;
      void worker.terminate();
      if (reply.ok) resolve(reply.result);
      else reject(new Error(reply.message));
    });
    worker.once('error', (error: unknown) => {
      answered = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    });
    worker.once('exit', (code) => {
      if (!answered) reject(new Error(`The pack worker exited with code ${String(code)}`));
    });
  });
}
