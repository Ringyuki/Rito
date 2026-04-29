import type { DisplayListOptions } from '../../render/display-list/types';
import type { ReaderSpreadFrame } from './types';

export type ReaderSpreadFrameCache = Map<string, ReaderSpreadFrame>;

export interface ReaderSpreadFrameCacheRequest {
  readonly spreadIndex: number;
  readonly displayListOptions?: DisplayListOptions | undefined;
}

export function createReaderSpreadFrameCache(): ReaderSpreadFrameCache {
  return new Map<string, ReaderSpreadFrame>();
}

export function getCachedReaderSpreadFrame(
  cache: ReaderSpreadFrameCache,
  request: ReaderSpreadFrameCacheRequest,
): ReaderSpreadFrame | undefined {
  return cache.get(createReaderSpreadFrameCacheKey(request));
}

export function setCachedReaderSpreadFrame(
  cache: ReaderSpreadFrameCache,
  request: ReaderSpreadFrameCacheRequest,
  frame: ReaderSpreadFrame,
): ReaderSpreadFrame {
  cache.set(createReaderSpreadFrameCacheKey(request), frame);
  return frame;
}

export function getOrSetCachedReaderSpreadFrame(
  cache: ReaderSpreadFrameCache,
  request: ReaderSpreadFrameCacheRequest,
  createFrame: () => ReaderSpreadFrame,
): ReaderSpreadFrame {
  return (
    getCachedReaderSpreadFrame(cache, request) ??
    setCachedReaderSpreadFrame(cache, request, createFrame())
  );
}

function createReaderSpreadFrameCacheKey(request: ReaderSpreadFrameCacheRequest): string {
  const options = request.displayListOptions;
  return JSON.stringify({
    spreadIndex: request.spreadIndex,
    displayListOptions:
      options === undefined
        ? null
        : {
            backgroundColor: options.backgroundColor ?? null,
            foregroundColor: options.foregroundColor ?? null,
            spreadBodyBg: options.spreadBodyBg ?? null,
          },
  });
}
