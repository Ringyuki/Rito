import type {
  RitoReaderSessionWorkerHandle,
  RitoReaderSessionWorkerHandlerDependencies,
  RitoReaderSessionWorkerScope,
} from './types';

/** How many artifacts a session of pages keeps live at once: the engine's cap. */
export declare const READER_LIVE_ARTIFACT_CAP: number;
/** How many artifacts a scrolled session keeps live at once: the engine's cap. */
export declare const READER_SCROLLED_LIVE_ARTIFACT_CAP: number;

export declare function createRitoCoreWasmReaderSessionWorkerHandler(
  scope: RitoReaderSessionWorkerScope,
  deps: RitoReaderSessionWorkerHandlerDependencies,
): RitoReaderSessionWorkerHandle;
