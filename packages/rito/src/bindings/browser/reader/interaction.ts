import type {
  ReaderInteractionTarget,
  ReaderInteractions,
  ReaderLocator,
  ReaderLocatorResolution,
  ReaderPageTargets,
} from '../../../reader';
import type {
  BrowserReaderWorkerClient,
  CoreFootnote,
  CorePageTargets,
  CoreRevisionHandle,
  CoreSourceLocator,
  CoreSourceLocatorResolution,
  CoreVersioned,
} from '../core-contracts';
import { isCurrentRevisionHandle } from './pipeline/revision-handle';
import type {
  BrowserReaderInteractionState,
  BrowserReaderRevisionHandle,
  BrowserReaderState,
} from './types';

const PAGE_TARGET_CACHE_CAPACITY = 12;

interface InteractionCapture {
  readonly worker: BrowserReaderWorkerClient;
  readonly revision: BrowserReaderRevisionHandle;
  readonly coreRevision: CoreRevisionHandle;
}

export function createBrowserReaderInteractionState(): BrowserReaderInteractionState {
  return { pageTargets: new Map(), pendingPageTargets: new Map() };
}

export function createBrowserReaderInteractions(state: BrowserReaderState): ReaderInteractions {
  return {
    get enabled() {
      return captureInteraction(state) !== undefined;
    },
    getPageTargets: (pageIndex) => getPageTargets(state, pageIndex),
    getFootnote: (key) => getFootnote(state, key),
    resolveLocator: (locator) => resolveLocator(state, locator),
  };
}

export function resetBrowserReaderInteractionCache(state: BrowserReaderState): void {
  state.interaction.pageTargets.clear();
  state.interaction.pendingPageTargets.clear();
}

async function getPageTargets(
  state: BrowserReaderState,
  pageIndex: number,
): Promise<ReaderPageTargets | undefined> {
  requirePageIndex(pageIndex);
  const capture = captureInteraction(state);
  if (!capture) return undefined;

  const cached = state.interaction.pageTargets.get(pageIndex);
  if (cached && sameRevision(cached.revision, capture.revision)) {
    touchPageTargets(state, pageIndex, cached);
    return cached.value;
  }
  if (cached) state.interaction.pageTargets.delete(pageIndex);

  const pending = state.interaction.pendingPageTargets.get(pageIndex);
  if (pending && sameRevision(pending.revision, capture.revision)) return pending.task;
  if (pending) state.interaction.pendingPageTargets.delete(pageIndex);

  const task = loadPageTargets(state, capture, pageIndex);
  state.interaction.pendingPageTargets.set(pageIndex, { revision: capture.revision, task });
  const clear = (): void => {
    if (state.interaction.pendingPageTargets.get(pageIndex)?.task === task) {
      state.interaction.pendingPageTargets.delete(pageIndex);
    }
  };
  void task.then(clear, clear);
  return task;
}

async function loadPageTargets(
  state: BrowserReaderState,
  capture: InteractionCapture,
  pageIndex: number,
): Promise<ReaderPageTargets | undefined> {
  const value = await readCapturedInteraction(state, capture, (worker, revision) =>
    worker.getPageTargetsAtRevision(revision, pageIndex),
  );
  if (!value) return undefined;
  requireMatchingSpread(state, value);
  const result = toReaderPageTargets(value);
  if (!captureIsCurrent(state, capture)) return undefined;
  cachePageTargets(state, pageIndex, { revision: capture.revision, value: result });
  return result;
}

async function getFootnote(state: BrowserReaderState, key: string) {
  const capture = captureInteraction(state);
  if (!capture) return undefined;
  const value = await readCapturedInteraction(state, capture, (worker, revision) =>
    worker.getFootnoteAtRevision(revision, key),
  );
  return value ? toReaderFootnote(value) : undefined;
}

async function resolveLocator(
  state: BrowserReaderState,
  locator: ReaderLocator,
): Promise<ReaderLocatorResolution | undefined> {
  const capture = captureInteraction(state);
  if (!capture) return undefined;
  const value = await readCapturedInteraction(state, capture, (worker, revision) =>
    worker.resolveSourceLocatorAtRevision(revision, copyLocator(locator)),
  );
  return value ? toReaderLocatorResolution(value) : undefined;
}

async function readCapturedInteraction<T>(
  state: BrowserReaderState,
  capture: InteractionCapture,
  read: (
    worker: BrowserReaderWorkerClient,
    revision: CoreRevisionHandle,
  ) => Promise<CoreVersioned<T>>,
): Promise<T | undefined> {
  if (!captureIsCurrent(state, capture)) return undefined;
  let response: CoreVersioned<T>;
  try {
    response = await read(capture.worker, capture.coreRevision);
  } catch (error) {
    if (!captureIsCurrent(state, capture)) return undefined;
    throw error;
  }
  if (!captureIsCurrent(state, capture)) return undefined;
  if (!sameCoreRevision(response.revision, capture.coreRevision)) {
    throw new Error('Reader interaction response does not match its revision request');
  }
  return response.value;
}

function captureInteraction(state: BrowserReaderState): InteractionCapture | undefined {
  if (state.disposed || state.visualPreview) return undefined;
  const revision = state.revisionHandle;
  const worker = state.worker;
  if (!revision || worker.sessionId !== revision.workerSessionId) return undefined;
  if (!isCurrentRevisionHandle(state, revision)) return undefined;
  return {
    worker,
    revision,
    coreRevision: {
      revisionId: revision.revisionId,
      revisionVersion: revision.revisionVersion,
    },
  };
}

function captureIsCurrent(state: BrowserReaderState, capture: InteractionCapture): boolean {
  return (
    !state.disposed &&
    state.visualPreview === undefined &&
    state.worker === capture.worker &&
    capture.worker.sessionId === capture.revision.workerSessionId &&
    isCurrentRevisionHandle(state, capture.revision)
  );
}

function sameRevision(
  left: BrowserReaderRevisionHandle,
  right: BrowserReaderRevisionHandle,
): boolean {
  return (
    left.workerSessionId === right.workerSessionId &&
    left.revisionId === right.revisionId &&
    left.revisionVersion === right.revisionVersion &&
    left.commitGeneration === right.commitGeneration
  );
}

function sameCoreRevision(left: CoreRevisionHandle, right: CoreRevisionHandle): boolean {
  return left.revisionId === right.revisionId && left.revisionVersion === right.revisionVersion;
}

function requirePageIndex(pageIndex: number): void {
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) {
    throw new TypeError('Reader interaction pageIndex must be a non-negative safe integer');
  }
}

function requireMatchingSpread(state: BrowserReaderState, value: CorePageTargets): void {
  const spread = state.revisionBundle.navigation.spreads.find((candidate) =>
    candidate.pageIndexes.includes(value.pageIndex),
  );
  if (!spread || spread.spreadIndex !== value.spreadIndex) {
    throw new Error('Reader page targets do not match committed navigation');
  }
}

function toReaderPageTargets(value: CorePageTargets): ReaderPageTargets {
  return {
    pageIndex: value.pageIndex,
    spreadIndex: value.spreadIndex,
    targets: value.entries.map(toReaderInteractionTarget),
  };
}

function toReaderInteractionTarget(
  target: CorePageTargets['entries'][number],
): ReaderInteractionTarget {
  return {
    kind: target.kind,
    bounds: { ...target.bounds },
    label: target.label,
    ...(target.href !== undefined ? { href: target.href } : {}),
    ...(target.sourceLocator ? { sourceLocator: copyLocator(target.sourceLocator) } : {}),
    ...(target.targetLocator ? { targetLocator: copyLocator(target.targetLocator) } : {}),
    ...(target.imageSrc !== undefined ? { imageSrc: target.imageSrc } : {}),
    ...(target.imageAlt !== undefined ? { imageAlt: target.imageAlt } : {}),
    ...(target.footnoteKey !== undefined ? { footnoteKey: target.footnoteKey } : {}),
  };
}

function copyLocator(locator: ReaderLocator | CoreSourceLocator): ReaderLocator {
  return {
    href: locator.href,
    ...(locator.anchorId !== undefined ? { anchorId: locator.anchorId } : {}),
    ...(locator.sourcePoint
      ? {
          sourcePoint: {
            nodePath: [...locator.sourcePoint.nodePath],
            textOffset: locator.sourcePoint.textOffset,
          },
        }
      : {}),
    ...(locator.sourceRange
      ? {
          sourceRange: {
            start: {
              nodePath: [...locator.sourceRange.start.nodePath],
              textOffset: locator.sourceRange.start.textOffset,
            },
            end: {
              nodePath: [...locator.sourceRange.end.nodePath],
              textOffset: locator.sourceRange.end.textOffset,
            },
          },
        }
      : {}),
    ...(locator.progression !== undefined ? { progression: locator.progression } : {}),
  };
}

function toReaderFootnote(value: CoreFootnote) {
  return { kind: value.kind, text: value.text, html: value.html };
}

function toReaderLocatorResolution(value: CoreSourceLocatorResolution): ReaderLocatorResolution {
  const common = {
    locator: copyLocator(value.locator),
    spineIdref: value.spineIdref,
    matchedBy: value.matchedBy,
  };
  return value.status === 'resolved'
    ? {
        status: 'resolved',
        ...common,
        pageIndex: value.pageIndex,
        spreadIndex: value.spreadIndex,
      }
    : { status: 'pending', ...common, reason: value.reason };
}

function touchPageTargets(
  state: BrowserReaderState,
  pageIndex: number,
  entry: BrowserReaderState['interaction']['pageTargets'] extends Map<number, infer Value>
    ? Value
    : never,
): void {
  state.interaction.pageTargets.delete(pageIndex);
  state.interaction.pageTargets.set(pageIndex, entry);
}

function cachePageTargets(
  state: BrowserReaderState,
  pageIndex: number,
  entry: Parameters<typeof touchPageTargets>[2],
): void {
  touchPageTargets(state, pageIndex, entry);
  while (state.interaction.pageTargets.size > PAGE_TARGET_CACHE_CAPACITY) {
    const oldest = state.interaction.pageTargets.keys().next().value;
    if (oldest === undefined) break;
    state.interaction.pageTargets.delete(oldest);
  }
}
