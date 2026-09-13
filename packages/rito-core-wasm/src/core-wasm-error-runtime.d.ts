export type RitoCoreWasmErrorCode =
  | 'bad-request'
  | 'engine-error'
  | 'internal-error'
  | 'unknown-revision'
  | 'stale-revision-version';

export interface RitoCoreWasmErrorOptions {
  readonly cause?: unknown;
}

export declare class RitoCoreWasmError extends Error {
  readonly code: RitoCoreWasmErrorCode;
  readonly cause?: unknown;

  constructor(code: RitoCoreWasmErrorCode, message: string, options?: RitoCoreWasmErrorOptions);
}

export declare function normalizeRitoCoreWasmError(
  error: unknown,
  operation?: string,
): RitoCoreWasmError;
