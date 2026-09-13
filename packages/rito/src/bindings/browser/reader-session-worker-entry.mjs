// Stable static worker boundary for source-mode bundlers. The package build emits
// reader-session-worker.ts as dist/reader-session-worker-entry.mjs so published consumers use
// the same URL.
import './reader-session-worker.ts';
