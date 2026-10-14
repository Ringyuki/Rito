/**
 * A publication split by `rito-pack`: the reader opens from the skeleton and
 * asks `loadShards` for each content shard the first time a call needs it.
 */
export interface RitoCoreWasmShardedPublication {
  readonly skeleton: ArrayBuffer;
  /** The skeleton's 32-byte key when the shards are encrypted. */
  readonly key?: Uint8Array | undefined;
  /**
   * Resolves with the requested shards. Rejecting fails the call that needed
   * them; the reader stays usable for everything else.
   */
  loadShards(shardIds: readonly number[]): Promise<readonly RitoCoreWasmPublicationShard[]>;
}

export interface RitoCoreWasmPublicationShard {
  readonly id: number;
  readonly bytes: ArrayBuffer | Uint8Array;
  /** The shard's own 32-byte key when the shards are encrypted. */
  readonly key?: Uint8Array | undefined;
}
