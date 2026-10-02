import type { BrowserReaderState } from './reader/types';

/**
 * When an image's stand-in shows, how a late image arrives, and when an
 * image that failed for a reason that can pass is read again.
 *
 * - A read under a second old shows nothing in the image's place: most
 *   images arrive well inside it and a placeholder would only flash.
 * - Past a second the loading placeholder shows; an image that arrives
 *   after that fades in over it.
 * - A failure that can pass (the host could not load the image's shard)
 *   shows the broken placeholder and is read again when its page is
 *   shown again, and while the page stays shown after 2s, 5s and then
 *   every 15s. A failure that cannot pass (the image is not in the
 *   publication, its bytes do not decode) stays broken.
 */
export const LOADING_PLACEHOLDER_DELAY_MS = 1000;
export const LATE_IMAGE_FADE_MS = 150;
const RETRY_DELAYS_MS = [2000, 5000, 15000] as const;

interface PendingRetry {
  readonly retry: () => void;
  attempt: number;
  due: number;
}

interface ImagePresence {
  readonly loadingSince: Map<string, number>;
  readonly revealedAt: Map<string, number>;
  readonly retries: Map<string, PendingRetry>;
  shownSpread: number | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
  frame: number | undefined;
}

const presences = new WeakMap<BrowserReaderState, ImagePresence>();

function presenceOf(state: BrowserReaderState): ImagePresence {
  let presence = presences.get(state);
  if (!presence) {
    presence = {
      loadingSince: new Map(),
      revealedAt: new Map(),
      retries: new Map(),
      shownSpread: undefined,
      timer: undefined,
      frame: undefined,
    };
    presences.set(state, presence);
  }
  return presence;
}

/** A read of `href` began; its placeholder shows if it is still out in a second. */
export function noteBrowserReaderImageLoading(state: BrowserReaderState, href: string): void {
  const presence = presenceOf(state);
  if (!presence.loadingSince.has(href)) presence.loadingSince.set(href, now());
  schedule(state, presence);
}

/** The read of `href` is over; an image that arrives late fades in. */
export function noteBrowserReaderImageSettled(
  state: BrowserReaderState,
  href: string,
  ready: boolean,
): void {
  const presence = presenceOf(state);
  const since = presence.loadingSince.get(href);
  presence.loadingSince.delete(href);
  if (ready) {
    presence.retries.delete(href);
    if (since !== undefined && now() - since >= LOADING_PLACEHOLDER_DELAY_MS) {
      presence.revealedAt.set(href, now());
    }
  }
  schedule(state, presence);
}

/** `href` failed for a reason that can pass; `retry` reads it again. */
export function noteBrowserReaderImageRetryable(
  state: BrowserReaderState,
  href: string,
  retry: () => void,
): void {
  const presence = presenceOf(state);
  const previous = presence.retries.get(href);
  const attempt = previous ? previous.attempt + 1 : 0;
  const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] as number;
  presence.retries.set(href, { retry, attempt, due: now() + delay });
  schedule(state, presence);
}

/**
 * A spread was shown. Showing a different spread than before reads its
 * retryable images again at once, with the backoff starting over.
 */
export function noteBrowserReaderSpreadShown(state: BrowserReaderState, spreadIndex: number): void {
  const presence = presenceOf(state);
  if (presence.shownSpread === spreadIndex) return;
  presence.shownSpread = spreadIndex;
  for (const href of state.frames.get(spreadIndex)?.resourceRefs.images ?? []) {
    const pending = presence.retries.get(href);
    if (!pending) continue;
    presence.retries.set(href, { ...pending, attempt: -1 });
    pending.retry();
  }
}

/** Which stand-in the image paints under now, given whether its bitmap and a failure exist. */
export function browserReaderImageFallback(
  state: BrowserReaderState,
  href: string,
  hasBitmap: boolean,
  failed: boolean,
): 'loading' | 'broken' | undefined {
  const presence = presenceOf(state);
  if (hasBitmap) return presence.revealedAt.has(href) ? 'loading' : undefined;
  if (failed) return 'broken';
  const since = presence.loadingSince.get(href);
  return since !== undefined && now() - since >= LOADING_PLACEHOLDER_DELAY_MS
    ? 'loading'
    : undefined;
}

/** The opacity a late image paints at while it fades in over its placeholder. */
export function browserReaderImageOpacity(state: BrowserReaderState, href: string): number {
  const revealed = presenceOf(state).revealedAt.get(href);
  if (revealed === undefined) return 1;
  return Math.min(1, Math.max(0, (now() - revealed) / LATE_IMAGE_FADE_MS));
}

/** Arms one timer for the next deadline, and animation frames while an image fades in. */
function schedule(state: BrowserReaderState, presence: ImagePresence): void {
  if (state.disposed) return;
  if (presence.revealedAt.size > 0 && presence.frame === undefined) {
    presence.frame = requestFrame(() => {
      presence.frame = undefined;
      tick(state, presence);
    });
  }
  // Only future deadlines arm the timer: a retry already made waits for
  // its outcome, and one due while its page is not shown waits for the
  // page to be shown again.
  const at = now();
  const deadlines = [
    ...[...presence.loadingSince.values()].map((since) => since + LOADING_PLACEHOLDER_DELAY_MS),
    ...[...presence.retries.values()].map((pending) => pending.due),
  ].filter((due) => Number.isFinite(due) && due > at);
  if (presence.timer !== undefined) clearTimeout(presence.timer);
  presence.timer = undefined;
  if (deadlines.length === 0) return;
  presence.timer = setTimeout(
    () => {
      presence.timer = undefined;
      tick(state, presence);
    },
    Math.min(...deadlines) - at,
  );
}

function tick(state: BrowserReaderState, presence: ImagePresence): void {
  if (state.disposed) return;
  const at = now();
  const changed = new Set<string>();
  for (const [href, since] of presence.loadingSince) {
    if (at - since >= LOADING_PLACEHOLDER_DELAY_MS) changed.add(href);
  }
  for (const [href, revealed] of presence.revealedAt) {
    changed.add(href);
    if (at - revealed >= LATE_IMAGE_FADE_MS) presence.revealedAt.delete(href);
  }
  const shown = state.frames.get(state.activeSpreadIndex)?.resourceRefs.images ?? [];
  for (const [href, pending] of presence.retries) {
    if (pending.due > at || !shown.includes(href)) continue;
    pending.due = Number.POSITIVE_INFINITY;
    pending.retry();
  }
  invalidateSpreadsDrawing(state, changed);
  schedule(state, presence);
}

function invalidateSpreadsDrawing(state: BrowserReaderState, hrefs: ReadonlySet<string>): void {
  if (hrefs.size === 0) return;
  // Snapshot first: a listener repaints synchronously, and reading a frame
  // moves it to the end of the frame cache, so iterating the live map
  // would visit the same spread again without end.
  const spreads = [...state.frames]
    .filter(([, frame]) => frame.resourceRefs.images.some((href) => hrefs.has(href)))
    .map(([spreadIndex]) => spreadIndex);
  for (const spreadIndex of spreads) {
    for (const listener of state.spreadContentInvalidatedListeners) listener(spreadIndex);
  }
}

function requestFrame(callback: () => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
  return setTimeout(callback, 16) as unknown as number;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
