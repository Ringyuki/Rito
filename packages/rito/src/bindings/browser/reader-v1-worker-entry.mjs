// Stable static worker boundary for source-mode bundlers. The package build emits
// reader-v1-worker.ts as dist/reader-v1-worker-entry.mjs so published consumers use
// the same URL.
import './reader-v1-worker.ts';
