import type { ReaderPublication } from '../../reader';
import type { CorePublicationShard, CoreShardedPublication } from './core-contracts';

/**
 * What a reader keeps to open its publication again in another worker (a
 * reflow lays the book out in a fresh worker): the archive bytes, or the
 * skeleton with a loader that remembers every shard it already fetched, so
 * a reopen supplies those without asking the host again.
 */
export type BrowserReaderPublicationSource = ArrayBuffer | CoreShardedPublication;

export function retainBrowserReaderPublication(
  publication: ReaderPublication,
): BrowserReaderPublicationSource {
  if (publication instanceof ArrayBuffer) return publication.slice(0);
  const loaded = new Map<number, CorePublicationShard>();
  const loadShards = publication.loadShards.bind(publication);
  return {
    skeleton: publication.skeleton.slice(0),
    ...(publication.key === undefined ? {} : { key: publication.key.slice() }),
    async loadShards(shardIds) {
      const missing = shardIds.filter((id) => !loaded.has(id));
      if (missing.length > 0) {
        for (const shard of await loadShards(missing)) loaded.set(shard.id, shard);
      }
      return shardIds.flatMap((id) => {
        const shard = loaded.get(id);
        return shard === undefined ? [] : [shard];
      });
    },
  };
}

/** The value a worker open consumes: archive bytes are transferred, so open a copy. */
export function openableBrowserReaderPublication(
  source: BrowserReaderPublicationSource,
): BrowserReaderPublicationSource {
  return source instanceof ArrayBuffer ? source.slice(0) : source;
}
