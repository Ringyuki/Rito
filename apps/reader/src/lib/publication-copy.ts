import type { ReaderPublication } from '@ritojs/core';

/**
 * A copy of a publication a reader can be given: opening a book hands its
 * bytes over to the reader's worker, so a book opened twice is given a copy
 * each time.
 */
export function copyPublication(publication: ReaderPublication): ReaderPublication {
  if (publication instanceof ArrayBuffer) return publication.slice(0);
  return {
    skeleton: publication.skeleton.slice(0),
    key: publication.key?.slice(),
    loadShards: (shardIds) => publication.loadShards(shardIds),
  };
}
