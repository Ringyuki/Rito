import type { ReaderLocatorResolution } from '../../reader';
import type { BrowserReaderBoundedSnapshot } from './core-contracts';
import { toReaderLocatorResolution } from './reader/interaction';

export interface LocatorRequestSettlement {
  readonly resolve: (value: ReaderLocatorResolution | undefined) => void;
  readonly reject: (error: unknown) => void;
  settled: boolean;
  stopWatchingAbort: (() => void) | undefined;
}

export function resolveLocatorSnapshot(
  request: LocatorRequestSettlement | undefined,
  snapshot: BrowserReaderBoundedSnapshot | undefined,
): void {
  if (!snapshot) {
    resolveLocatorRequest(request, undefined);
    return;
  }
  if (snapshot.target.kind !== 'locator') {
    rejectLocatorRequest(
      request,
      new Error('Bounded reader locator mutation returned a different target'),
    );
    return;
  }
  resolveLocatorRequest(request, toReaderLocatorResolution(snapshot.target.resolution));
}

export function resolveLocatorRequest(
  request: LocatorRequestSettlement | undefined,
  value: ReaderLocatorResolution | undefined,
): void {
  if (!request || request.settled) return;
  request.settled = true;
  request.stopWatchingAbort?.();
  request.resolve(value);
}

export function rejectLocatorRequest(
  request: LocatorRequestSettlement | undefined,
  error: unknown,
): void {
  if (!request || request.settled) return;
  request.settled = true;
  request.stopWatchingAbort?.();
  request.reject(error);
}
