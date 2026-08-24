import type { RitoCoreWasmRevisionSummary } from './types/revision';

export type RitoCoreWasmErrorCode =
  | 'bad-request'
  | 'engine-error'
  | 'internal-error'
  | 'unknown-revision'
  | 'stale-revision-version';

export interface RitoCoreWasmErrorOptions {
  readonly cause?: unknown;
  readonly revision?: RitoCoreWasmRevisionSummary | undefined;
}

export declare class RitoCoreWasmError extends Error {
  readonly code: RitoCoreWasmErrorCode;
  readonly cause?: unknown;
  readonly revision?: RitoCoreWasmRevisionSummary | undefined;

  constructor(code: RitoCoreWasmErrorCode, message: string, options?: RitoCoreWasmErrorOptions);
}

export declare function normalizeRitoCoreWasmError(
  error: unknown,
  operation?: string,
): RitoCoreWasmError;
