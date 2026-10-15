// What the placeholder build declares for `./pack` in place of the
// declarations wasm-bindgen writes for crates/rito-pack: the part of them
// @ritojs/pack uses.

export class PackedPublication {
  private constructor();
  free(): void;
  shardBytes(index: number): Uint8Array;
  shardFiles(index: number): string[];
  shardId(index: number): number;
  shardKey(index: number): Uint8Array | undefined;
  readonly bookId: Uint8Array;
  readonly formatVersion: number;
  readonly shardCount: number;
}

export class PublicationCheck {
  private constructor();
  free(): void;
  problemMessage(index: number): string;
  problemPath(index: number): string;
  readonly error: string | undefined;
  readonly problemCount: number;
}

export function checkPublication(epub: Uint8Array): PublicationCheck;

export function packPublication(
  epub: Uint8Array,
  encrypt: boolean,
  random: (buffer: Uint8Array<ArrayBuffer>) => void,
): PackedPublication;

export type SyncInitInput = BufferSource | WebAssembly.Module;

export function initSync(module: { module: SyncInitInput }): unknown;
