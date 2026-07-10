// Stable static worker boundary for source-mode bundlers. The package build emits
// worker-main.ts as dist/worker-entry.mjs so published consumers use the same URL.
import { startBrowserReaderWorker } from './worker-bootstrap.ts';

startBrowserReaderWorker();
