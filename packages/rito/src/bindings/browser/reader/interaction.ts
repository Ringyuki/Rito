import type {
  ReaderInteractionTarget,
  ReaderInteractions,
  ReaderLocator,
  ReaderLocatorResolution,
  ReaderPageTargets,
} from '../../../reader';
import type {
  CoreFootnote,
  CorePageTargets,
  CoreSourceLocator,
  CoreSourceLocatorResolution,
} from '../core-contracts';
import {
  captureInteraction,
  captureIsCurrent,
  readCapturedInteraction,
  sameRevision,
  type BrowserReaderInteractionCapture,
} from './interaction-capture';
import { createBrowserReaderTextSelection } from './text-selection';
import { resolveExactSourceRange } from './source-range';
import type { BrowserReaderInteractionState, BrowserReaderState } from './types';

const PAGE_TARGET_CACHE_CAPACITY = 12;
export function createBrowserReaderInteractionState(): BrowserReaderInteractionState {
  return { pageTargets: new Map(), pendingPageTargets: new Map() };
}
export function createBrowserReaderInteractions(state: BrowserReaderState): ReaderInteractions {
  return {
    get enabled() {
      return captureInteraction(state) !== undefined;
    },
    getPageSemantics: (pageIndex) => getPageSemantics(state, pageIndex),
    getPageTargets: (pageIndex) => getPageTargets(state, pageIndex),
    getFootnote: (key) => getFootnote(state, key),
    resolveLocator: (locator) => resolveLocator(state, locator),
    resolveExactSourceRange: (request) => resolveExactSourceRange(state, request),
    textSelection: createBrowserReaderTextSelection(state),
  };
}

async function getPageSemantics(state: BrowserReaderState, pageIndex: number) {
  requirePageIndex(pageIndex);
  const capture = captureInteraction(state);
  if (!capture) return undefined;
  const value = await readCapturedInteraction(state, capture, (worker, revision) =>
    worker.getPageSemanticsAtRevision(revision, pageIndex),
  );
  if (!value) return undefined;
  if (value.revisionId !== capture.coreRevision.revisionId || value.pageIndex !== pageIndex) {
    throw new Error('Reader page semantics response does not match its request');
  }
  requireMatchingSpread(state, value, 'semantics');
  return {
    pageIndex: value.pageIndex,
    spreadIndex: value.spreadIndex,
    nodes: value.nodes,
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
    cachePageTargets(state, pageIndex, cached);
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
  capture: BrowserReaderInteractionCapture,
  pageIndex: number,
): Promise<ReaderPageTargets | undefined> {
  const value = await readCapturedInteraction(state, capture, (worker, revision) =>
    worker.getPageTargetsAtRevision(revision, pageIndex),
  );
  if (!value) return undefined;
  if (value.revisionId !== capture.coreRevision.revisionId || value.pageIndex !== pageIndex) {
    throw new Error('Reader page targets response does not match its request');
  }
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

function requirePageIndex(pageIndex: number): void {
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) {
    throw new TypeError('Reader interaction pageIndex must be a non-negative safe integer');
  }
}

function requireMatchingSpread(
  state: BrowserReaderState,
  value: Pick<CorePageTargets, 'pageIndex' | 'spreadIndex'>,
  subject = 'targets',
): void {
  const spread = state.revisionBundle.navigation.spreads.find((candidate) =>
    candidate.pageIndexes.includes(value.pageIndex),
  );
  if (!spread || spread.spreadIndex !== value.spreadIndex) {
    throw new Error(`Reader page ${subject} do not match committed navigation`);
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
    ...(locator.sourcePoint ? { sourcePoint: copySourcePoint(locator.sourcePoint) } : {}),
    ...(locator.sourceRange
      ? {
          sourceRange: {
            start: copySourcePoint(locator.sourceRange.start),
            end: copySourcePoint(locator.sourceRange.end),
          },
        }
      : {}),
    ...(locator.progression !== undefined ? { progression: locator.progression } : {}),
  };
}

function copySourcePoint(point: NonNullable<ReaderLocator['sourcePoint']>) {
  return { nodePath: [...point.nodePath], textOffset: point.textOffset };
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
  if (value.status === 'pending') return { status: 'pending', ...common, reason: value.reason };
  return {
    status: 'resolved',
    ...common,
    pageIndex: value.pageIndex,
    spreadIndex: value.spreadIndex,
  };
}

function cachePageTargets(
  state: BrowserReaderState,
  pageIndex: number,
  entry: NonNullable<ReturnType<typeof state.interaction.pageTargets.get>>,
): void {
  const cache = state.interaction.pageTargets;
  cache.delete(pageIndex);
  cache.set(pageIndex, entry);
  if (cache.size <= PAGE_TARGET_CACHE_CAPACITY) return;
  const oldest = cache.keys().next().value;
  if (oldest !== undefined) cache.delete(oldest);
}
