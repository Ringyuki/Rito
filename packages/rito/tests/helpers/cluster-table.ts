import type { RitoReaderClusters } from '@ritojs/core-wasm/decoder';

/** One cluster: its byte offset into the run's text, its origin, and
 * whether it joins the cluster before it. */
export type ClusterRow = readonly [byte: number, x: number, y: number, joins?: boolean];

/** A run's packed cluster table, built the way the decoder builds it. */
export function clusterTable(rows: readonly ClusterRow[]): RitoReaderClusters {
  return {
    bytes: Uint32Array.from(rows, ([byte]) => byte),
    origins: Float32Array.from(rows.flatMap(([, x, y]) => [x, y])),
    joins: Uint8Array.from(rows, ([, , , joins]) => (joins === true ? 1 : 0)),
  };
}

export const NO_CLUSTERS: RitoReaderClusters = clusterTable([]);
