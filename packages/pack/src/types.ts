export interface PackOptions {
  /**
   * Seal every shard, the skeleton included, with its own random 256-bit
   * key (XChaCha20-Poly1305). A shard is useless without its key.
   */
  readonly encrypt?: boolean | undefined;
}

/**
 * One shard. `{ id, bytes, key }` is what a reader's `loadShards` returns
 * for it.
 */
export interface PackedShard {
  /** `0` for the skeleton, then `1`, `2`, … for the content shards. */
  readonly id: number;
  readonly bytes: Uint8Array;
  /** The shard's 32-byte key, present exactly when the publication is encrypted. */
  readonly key?: Uint8Array;
  /** The EPUB archive paths the shard carries. */
  readonly files: readonly string[];
}

export interface PackedPublication {
  /**
   * Random per packing, as 32 hex digits. A reading session refuses shards
   * from another packing of the same book.
   */
  readonly bookId: string;
  /** The shard format the publication was packed in. */
  readonly formatVersion: number;
  readonly encrypted: boolean;
  /**
   * Every file layout reads (chapters, stylesheets, fonts, navigation), the
   * file table and every image's size: a reader opens the book from it.
   */
  readonly skeleton: PackedShard;
  /** One shard per image, audio or video file, by ascending id. */
  readonly shards: readonly PackedShard[];
}

/** A file the reader shows degraded instead of failing the book. */
export interface PublicationProblem {
  /** The file's path in the EPUB archive. */
  readonly path: string;
  readonly message: string;
}

/**
 * Whether the reader can read a publication. Unreadable carries the error
 * the reader fails with; readable lists the files it shows degraded.
 */
export type PublicationCheck =
  | { readonly readable: true; readonly problems: readonly PublicationProblem[] }
  | { readonly readable: false; readonly error: string };
