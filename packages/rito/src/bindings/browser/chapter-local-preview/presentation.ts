import type { Reader, ReaderLocator } from '../../../reader';
import type { BrowserReaderState } from '../reader/types';
import type { CanvasRenderingTarget } from '../rendering';
import { renderBrowserReaderChapterLocalFrameToContext } from '../rendering';
import {
  notifyBrowserReaderChapterLocalFrameComposited,
  notifyBrowserReaderChapterLocalTransitionSettled,
} from '../adaptive-continuation-batch';
import { finishBrowserReaderChapterLocalPresentation } from './coordinator';
import { activeBrowserReaderChapterLocalPreview, sameBrowserReaderLocator } from './state';
import type { BrowserReaderChapterLocalOwner } from './types';

const PRESENTATION = Symbol.for('@ritojs/core/browser/chapter-local-preview-presentation');

interface BrowserReaderChapterLocalPresentationLease {
  readonly direction: 'forward' | 'backward';
  render(ctx: CanvasRenderingTarget): boolean;
  composited(): boolean;
  transitionSettled(): boolean;
  finish(): boolean;
}

interface BrowserReaderChapterLocalPresentationCapability {
  canClaim(locator: ReaderLocator, spreadIndex: number): boolean;
  claim(
    locator: ReaderLocator,
    spreadIndex: number,
  ): BrowserReaderChapterLocalPresentationLease | undefined;
}

export function installBrowserReaderChapterLocalPresentation(
  reader: Partial<Reader>,
  state: BrowserReaderState,
): void {
  const capability: BrowserReaderChapterLocalPresentationCapability = {
    canClaim: (locator, spreadIndex) => canClaimPresentation(state, locator, spreadIndex),
    claim: (locator, spreadIndex) => claimPresentation(state, locator, spreadIndex),
  };
  Object.defineProperty(reader, PRESENTATION, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: capability,
  });
}

function claimPresentation(
  state: BrowserReaderState,
  locator: ReaderLocator,
  spreadIndex: number,
): BrowserReaderChapterLocalPresentationLease | undefined {
  if (!canClaimPresentation(state, locator, spreadIndex)) return undefined;
  const active = activeBrowserReaderChapterLocalPreview(state, spreadIndex);
  if (!active) return undefined;
  active.presentationStarted = true;
  const requestId = active.request.id;
  const owner = active.owner;
  let rendered = false;
  let composited = false;
  let settled = false;
  let finished = false;
  return {
    direction: active.request.direction,
    render(ctx): boolean {
      const current = state.chapterLocalPreview.active;
      if (
        finished ||
        current?.request.id !== requestId ||
        current.owner.revisionId !== owner.revisionId ||
        current.owner.revisionVersion !== owner.revisionVersion
      ) {
        return false;
      }
      const painted = renderBrowserReaderChapterLocalFrameToContext(
        state,
        current.frame,
        current.images,
        ctx,
      );
      if (painted) rendered = true;
      return painted;
    },
    composited(): boolean {
      if (finished || !rendered || !ownsPresentation(state, requestId, owner)) return false;
      if (!composited) {
        composited = true;
        notifyBrowserReaderChapterLocalFrameComposited(state, active.request);
        if (settled) {
          notifyBrowserReaderChapterLocalTransitionSettled(state, active.request);
        }
      }
      return true;
    },
    transitionSettled(): boolean {
      if (finished || !ownsPresentation(state, requestId, owner)) return false;
      if (!settled) {
        settled = true;
        if (composited) {
          notifyBrowserReaderChapterLocalTransitionSettled(state, active.request);
        }
      }
      return true;
    },
    finish(): boolean {
      if (finished) return false;
      finished = true;
      return finishBrowserReaderChapterLocalPresentation(state, requestId, owner, settled);
    },
  };
}

function canClaimPresentation(
  state: BrowserReaderState,
  locator: ReaderLocator,
  spreadIndex: number,
): boolean {
  const active = activeBrowserReaderChapterLocalPreview(state, spreadIndex);
  return (
    active !== undefined &&
    !active.presentationStarted &&
    !active.request.mainSettled &&
    sameBrowserReaderLocator(active.request.locator, locator)
  );
}

function ownsPresentation(
  state: BrowserReaderState,
  requestId: number,
  owner: BrowserReaderChapterLocalOwner,
): boolean {
  const active = state.chapterLocalPreview.active;
  return (
    !state.disposed &&
    active?.request.id === requestId &&
    active.owner.revisionId === owner.revisionId &&
    active.owner.revisionVersion === owner.revisionVersion
  );
}
