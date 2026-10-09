// Stable static worker boundary for source-mode bundlers. The package build emits
// reader-session-worker-main.ts as dist/reader-session-worker-entry.mjs so published
// consumers use the same URL. The entry calls the start function itself: the package
// declares no side effects, so a bundler drops a module imported only for its own.
import { startBrowserReaderSessionWorker } from './reader-session-worker.ts';

startBrowserReaderSessionWorker();
