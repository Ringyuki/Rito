import type { PackedPublication, PublicationCheck } from './types';

/** What one call asks of its worker. */
export type TaskInput =
  | { readonly kind: 'pack'; readonly epub: Uint8Array; readonly encrypt: boolean }
  | { readonly kind: 'check'; readonly epub: Uint8Array };

/** The worker's data: the task and the pack module compiled once per process. */
export type WorkerTask = TaskInput & { readonly module: WebAssembly.Module };

export type TaskResult =
  | { readonly kind: 'pack'; readonly value: PackedPublication }
  | { readonly kind: 'check'; readonly value: PublicationCheck };

/** The worker's one message back. */
export type WorkerReply =
  | { readonly ok: true; readonly result: TaskResult }
  | { readonly ok: false; readonly message: string };
