import type { RitoCoreWasmJsonValue } from './common';

export interface DecodedRitoRuntimeBundle {
  readonly protocolVersion: 1;
  readonly stringCount: number;
  readonly valueCount: number;
  readonly byteLength: number;
  readonly checksum: string;
  readonly payload: RitoCoreWasmRuntimeBundlePayload;
}

export type RitoCoreWasmRuntimeBundlePayload = RitoCoreWasmJsonValue;
export type RitoCoreWasmReaderRuntimeWire = 'json' | 'ritorb1';
