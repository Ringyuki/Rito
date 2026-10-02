export type RitoCoreWasmErrorCode =
  | 'bad-request'
  | 'engine-error'
  | 'internal-error'
  | 'unknown-revision'
  | 'stale-revision-version'
  | 'resource-pending';

export interface RitoCoreWasmErrorOptions {
  readonly cause?: unknown;
  /** Required with `resource-pending`: the content shards to supply. */
  readonly pendingShards?: readonly number[] | undefined;
}

export declare class RitoCoreWasmError extends Error {
  readonly code: RitoCoreWasmErrorCode;
  readonly cause?: unknown;
  /**
   * Present exactly for `resource-pending`: ids of the content shards the
   * publication was opened from that the operation needs and the host has
   * not supplied. Supply them and retry the same call.
   */
  readonly pendingShards?: readonly number[];

  constructor(code: RitoCoreWasmErrorCode, message: string, options?: RitoCoreWasmErrorOptions);
}

export declare function normalizeRitoCoreWasmError(
  error: unknown,
  operation?: string,
): RitoCoreWasmError;
