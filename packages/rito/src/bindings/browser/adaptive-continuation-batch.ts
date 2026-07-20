import type { BrowserReaderBoundedSessionOwner } from './reader-session-host';
import type { BrowserReaderChapterLocalPreviewRequest } from './chapter-local-preview/types';
import type { BrowserReaderState } from './reader/types';

type ContinuationBatchQuanta = 1 | 4 | 16;

interface ContinuationBatchControl {
  active: boolean;
  epoch: symbol;
  target: symbol | undefined;
  quanta: ContinuationBatchQuanta;
}

interface ContinuationBatchRequestBinding {
  readonly intent: BrowserReaderContinuationBatchIntent;
  readonly target: symbol;
  composited: boolean;
  transitionSettled: boolean;
}

export interface BrowserReaderContinuationBatchRegistration {
  readonly resolve: () => ContinuationBatchQuanta;
  attach(owner: BrowserReaderBoundedSessionOwner): void;
}

export interface BrowserReaderContinuationBatchIntent {
  readonly owner: BrowserReaderBoundedSessionOwner;
  readonly workerSessionId: string;
  readonly epoch: symbol;
}

const ownerControls = new WeakMap<BrowserReaderBoundedSessionOwner, ContinuationBatchControl>();
const requestBindings = new WeakMap<
  BrowserReaderChapterLocalPreviewRequest,
  ContinuationBatchRequestBinding
>();

/** Create the dynamic resolver before its bounded owner exists, then attach it exactly once. */
export function createBrowserReaderContinuationBatchRegistration(): BrowserReaderContinuationBatchRegistration {
  const control: ContinuationBatchControl = {
    active: true,
    epoch: Symbol('bounded-owner'),
    target: undefined,
    quanta: 1,
  };
  let attached = false;
  return {
    resolve: () => control.quanta,
    attach(owner): void {
      if (attached || ownerControls.has(owner)) {
        throw new Error('Bounded reader continuation batch owner was attached more than once');
      }
      attached = true;
      ownerControls.set(owner, control);
    },
  };
}

/** Reset cancellation latency synchronously when a new navigation intent is accepted. */
export function beginBrowserReaderContinuationBatchIntent(
  state: BrowserReaderState,
): BrowserReaderContinuationBatchIntent | undefined {
  const owner = state.boundedSessions.current;
  const control = owner ? ownerControls.get(owner) : undefined;
  if (
    state.disposed ||
    !owner ||
    !control?.active ||
    owner.terminalError ||
    owner.worker !== state.worker
  ) {
    return undefined;
  }
  control.epoch = Symbol('navigation-intent');
  control.target = undefined;
  control.quanta = 1;
  return {
    owner,
    workerSessionId: owner.worker.sessionId,
    epoch: control.epoch,
  };
}

export function bindBrowserReaderContinuationBatchIntent(
  request: BrowserReaderChapterLocalPreviewRequest,
  intent: BrowserReaderContinuationBatchIntent,
): void {
  requestBindings.set(request, {
    intent,
    target: Symbol('locator-target'),
    composited: false,
    transitionSettled: false,
  });
}

/** A candidate has no provisional surface; prioritize reaching its first exact target. */
export function activateBrowserReaderContinuationBatchCandidate(
  owner: BrowserReaderBoundedSessionOwner,
): boolean {
  const control = ownerControls.get(owner);
  if (!control?.active) return false;
  control.target = undefined;
  control.quanta = 16;
  return true;
}

/** An exact-only target has no visual transition whose callbacks could promote it. */
export function activateBrowserReaderContinuationBatchTargetWithoutPreview(
  state: BrowserReaderState,
  intent: BrowserReaderContinuationBatchIntent | undefined,
): boolean {
  if (!intent) return false;
  const control = liveIntentControl(state, intent);
  if (!control) return false;
  control.target = undefined;
  control.quanta = 16;
  return true;
}

export function createBrowserReaderContinuationBatchLocatorLifecycle(
  state: BrowserReaderState,
  preview: BrowserReaderChapterLocalPreviewRequest | undefined,
  intent: BrowserReaderContinuationBatchIntent | undefined,
): {
  readonly onTargetStarted: () => void;
  readonly onCancelled: () => void;
} {
  return {
    onTargetStarted(): void {
      if (preview) {
        activateBrowserReaderContinuationBatchTarget(state, preview);
      } else {
        activateBrowserReaderContinuationBatchTargetWithoutPreview(state, intent);
      }
    },
    onCancelled(): void {
      resetBrowserReaderContinuationBatchIntent(state, intent);
    },
  };
}

/** Bind promotion to the exact controller target, not merely to its parallel preview. */
export function activateBrowserReaderContinuationBatchTarget(
  state: BrowserReaderState,
  request: BrowserReaderChapterLocalPreviewRequest,
): boolean {
  const binding = requestBindings.get(request);
  const control = binding ? liveIntentControl(state, binding.intent) : undefined;
  if (
    !binding ||
    !control ||
    request.id !== state.chapterLocalPreview.latestRequestId ||
    request.workerSessionId !== binding.intent.workerSessionId
  ) {
    return false;
  }
  control.target = binding.target;
  control.quanta = binding.composited ? (binding.transitionSettled ? 16 : 4) : 1;
  return true;
}

/** Keep cancellation bounded when an active or queued locator intent is aborted. */
export function resetBrowserReaderContinuationBatchIntent(
  state: BrowserReaderState,
  intent: BrowserReaderContinuationBatchIntent | undefined,
): boolean {
  if (!intent) return false;
  const control = liveIntentControl(state, intent);
  if (!control) return false;
  control.epoch = Symbol('cancelled-intent');
  control.target = undefined;
  control.quanta = 1;
  return true;
}

/** Raise throughput only after the provisional raster reached the display surface. */
export function notifyBrowserReaderChapterLocalFrameComposited(
  state: BrowserReaderState,
  request: BrowserReaderChapterLocalPreviewRequest,
): boolean {
  const live = livePreviewBinding(state, request);
  if (!live) return false;
  live.binding.composited = true;
  if (live.control.target === live.binding.target && live.control.quanta < 4) {
    live.control.quanta = 4;
  }
  return true;
}

/** Raise background throughput only after the visual transition has fully settled. */
export function notifyBrowserReaderChapterLocalTransitionSettled(
  state: BrowserReaderState,
  request: BrowserReaderChapterLocalPreviewRequest,
): boolean {
  const live = livePreviewBinding(state, request);
  if (!live || !live.binding.composited) return false;
  live.binding.transitionSettled = true;
  if (live.control.target === live.binding.target) live.control.quanta = 16;
  return true;
}

export function retireBrowserReaderContinuationBatchOwner(
  owner: BrowserReaderBoundedSessionOwner,
): void {
  const control = ownerControls.get(owner);
  if (!control || !control.active) return;
  control.active = false;
  control.epoch = Symbol('retired-owner');
  control.target = undefined;
  control.quanta = 1;
}

function livePreviewBinding(
  state: BrowserReaderState,
  request: BrowserReaderChapterLocalPreviewRequest,
):
  | {
      readonly binding: ContinuationBatchRequestBinding;
      readonly control: ContinuationBatchControl;
    }
  | undefined {
  const binding = requestBindings.get(request);
  const active = state.chapterLocalPreview.active;
  if (
    !binding ||
    active?.request !== request ||
    request.id !== state.chapterLocalPreview.latestRequestId ||
    request.workerSessionId !== binding.intent.workerSessionId
  ) {
    return undefined;
  }
  const control = liveIntentControl(state, binding.intent);
  return control ? { binding, control } : undefined;
}

function liveIntentControl(
  state: BrowserReaderState,
  intent: BrowserReaderContinuationBatchIntent,
): ContinuationBatchControl | undefined {
  const currentOwner = state.boundedSessions.current;
  if (
    state.disposed ||
    currentOwner !== intent.owner ||
    state.worker !== intent.owner.worker ||
    intent.owner.worker.sessionId !== intent.workerSessionId
  ) {
    return undefined;
  }
  const control = ownerControls.get(intent.owner);
  return control?.active && control.epoch === intent.epoch ? control : undefined;
}
