import type { ReaderControllerEvents } from '../types';
import type { WiringDeps } from '../core/wiring-deps';

type ImageClickEvent = ReaderControllerEvents['imageClick'];
type Mapper = NonNullable<WiringDeps['coordState']['mapper']>;

export function dispatchImageResourceClick(
  request: Omit<ImageClickEvent, 'blobUrl'>,
  mapper: Mapper,
  deps: WiringDeps,
): void {
  if (!request.src) return;
  const generation = beginImageRequest(deps);
  let result: ReturnType<typeof deps.reader.getImageBlobUrl>;
  try {
    result = deps.reader.getImageBlobUrl(request.src);
  } catch (error) {
    containImageFailure(error, generation, mapper, deps);
    return;
  }
  if (typeof result === 'string' || result === undefined) {
    settleImageRequest(result, request, generation, mapper, deps);
    return;
  }
  void result
    .then((blobUrl) => {
      settleImageRequest(blobUrl, request, generation, mapper, deps);
    })
    .catch((error: unknown) => {
      containImageFailure(error, generation, mapper, deps);
    });
}

/** Invalidates pending image requests and releases the controller-owned URL. */
export function releaseImageClickResources(deps: Pick<WiringDeps, 'coordState'>): void {
  supersedePendingImageRequest(deps);
  revokeActiveImageUrl(deps.coordState);
}

/** Supersedes only pending work; an already displayed URL remains valid. */
export function supersedePendingImageRequest(deps: Pick<WiringDeps, 'coordState'>): void {
  deps.coordState.contentInteractionGeneration += 1;
}

function beginImageRequest(deps: WiringDeps): number {
  releaseImageClickResources(deps);
  return deps.coordState.contentInteractionGeneration;
}

function settleImageRequest(
  blobUrl: string | undefined,
  request: Omit<ImageClickEvent, 'blobUrl'>,
  generation: number,
  mapper: Mapper,
  deps: WiringDeps,
): void {
  if (!blobUrl) return;
  if (!ownsImageRequest(generation, mapper, deps)) {
    revokeImageUrl(blobUrl);
    return;
  }
  deps.coordState.activeImageBlobUrl = blobUrl;
  try {
    deps.emitter.emit('imageClick', { ...request, blobUrl });
  } catch (error: unknown) {
    containCurrentImageFailure(error, 'image-click-publication', generation, mapper, deps);
  }
}

function containImageFailure(
  error: unknown,
  generation: number,
  mapper: Mapper,
  deps: WiringDeps,
): void {
  containCurrentImageFailure(error, 'image-resource', generation, mapper, deps);
}

function containCurrentImageFailure(
  error: unknown,
  source: string,
  generation: number,
  mapper: Mapper,
  deps: WiringDeps,
): void {
  try {
    reportCurrentImageFailure(error, source, generation, mapper, deps);
  } catch {
    // Event listeners are user code; never leak an interaction failure to the caller or task queue.
  }
}

function reportCurrentImageFailure(
  error: unknown,
  source: string,
  generation: number,
  mapper: Mapper,
  deps: WiringDeps,
): void {
  if (!ownsImageRequest(generation, mapper, deps)) return;
  deps.emitter.emit('error', {
    message: error instanceof Error ? error.message : String(error),
    source,
  });
}

function ownsImageRequest(generation: number, mapper: Mapper, deps: WiringDeps): boolean {
  return (
    deps.coordState.nativeInteractionsAlive &&
    deps.coordState.contentInteractionGeneration === generation &&
    deps.coordState.mapper === mapper
  );
}

function revokeActiveImageUrl(state: WiringDeps['coordState']): void {
  const active = state.activeImageBlobUrl;
  state.activeImageBlobUrl = null;
  if (active) revokeImageUrl(active);
}

function revokeImageUrl(url: string): void {
  if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(url);
  }
}
