import type { BrowserReaderCanvasDecodedImage } from './reader-session-canvas-image-cache-support';

/** The cache side a lease draws on: loading one image, and owning its entry. */
export interface BrowserReaderCanvasImageSource {
  load(href: string): Promise<string>;
  resolve(key: string): BrowserReaderCanvasDecodedImage | undefined;
  release(key: string): void;
  readonly disposed: boolean;
}

const PLACEHOLDER_DELAY_MS = 1000;
const FADE_MS = 150;
const FADE_STEP_MS = 16;
const RETRY_DELAYS_MS = [2000, 5000, 15000] as const;

/**
 * One artifact's images, filled in as they land.
 *
 * An image under a second on its way paints nothing; past a second its
 * loading placeholder paints, and once it lands it fades in over that
 * placeholder in 150ms. An image that failed paints its broken
 * placeholder. One that failed for a reason that can pass (the host could
 * not load the image's shard) is read again after 2s, 5s and then every
 * 15s while something listens for changes, and at once when something
 * starts listening again. Listeners hear every change.
 */
export class BrowserReaderCanvasImageLease {
  private readonly keys = new Map<string, string>();
  private readonly failed = new Map<string, unknown>();
  private readonly placeholderShown = new Set<string>();
  private readonly fadingSince = new Map<string, number>();
  private readonly retryAttempts = new Map<string, number>();
  private readonly retriesDue = new Set<string>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly listeners = new Set<() => void>();
  private readonly unsettled: Set<string>;
  private fadeTimer: ReturnType<typeof setTimeout> | undefined;
  private released = false;
  private settle!: () => void;
  readonly settled: Promise<void>;

  constructor(
    private readonly hrefs: ReadonlySet<string>,
    private readonly source: BrowserReaderCanvasImageSource,
  ) {
    this.unsettled = new Set(hrefs);
    this.settled = new Promise((resolve) => {
      this.settle = resolve;
    });
    if (hrefs.size === 0) this.settle();
    for (const href of hrefs) this.start(href);
  }

  has(href: string): boolean {
    return !this.released && this.hrefs.has(href);
  }

  resolve(href: string): BrowserReaderCanvasDecodedImage | undefined {
    const key = this.keys.get(href);
    return this.released || key === undefined ? undefined : this.source.resolve(key);
  }

  /** The placeholder that stands in `href`'s place now, if any. */
  fallback(href: string): 'loading' | 'broken' | undefined {
    if (this.keys.has(href)) return this.fadingSince.has(href) ? 'loading' : undefined;
    if (this.failed.has(href)) return 'broken';
    return this.placeholderShown.has(href) ? 'loading' : undefined;
  }

  /** The opacity `href` paints at: below one while it fades in. */
  opacity(href: string): number {
    const since = this.fadingSince.get(href);
    return since === undefined ? 1 : Math.min(1, (now() - since) / FADE_MS);
  }

  /** Calls `listener` whenever what the artifact paints for its images changes. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    for (const href of [...this.retriesDue]) {
      this.retriesDue.delete(href);
      this.retryAttempts.set(href, -1);
      this.retry(href);
    }
    return () => this.listeners.delete(listener);
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    if (this.fadeTimer !== undefined) clearTimeout(this.fadeTimer);
    this.listeners.clear();
    this.settle();
    const failures: unknown[] = [];
    for (const key of this.keys.values()) {
      try {
        this.source.release(key);
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError(failures, 'reader session image lease release failed.');
  }

  private start(href: string): void {
    this.after(PLACEHOLDER_DELAY_MS, () => {
      if (this.keys.has(href) || this.failed.has(href)) return;
      this.placeholderShown.add(href);
      this.notify();
    });
    this.source.load(href).then(
      (key) => {
        this.landed(href, key);
      },
      (error: unknown) => {
        this.failedWith(href, error);
      },
    );
  }

  private landed(href: string, key: string): void {
    if (this.released) {
      this.source.release(key);
      return;
    }
    this.keys.set(href, key);
    this.retryAttempts.delete(href);
    if (this.placeholderShown.delete(href)) {
      this.fadingSince.set(href, now());
      this.stepFades();
    }
    this.settleOne(href);
    this.notify();
  }

  private failedWith(href: string, error: unknown): void {
    if (this.released || this.source.disposed) {
      this.settleOne(href);
      return;
    }
    this.failed.set(href, error);
    recordImageFailure(href, error);
    if (isRetryable(error)) {
      const attempt = (this.retryAttempts.get(href) ?? -1) + 1;
      this.retryAttempts.set(href, attempt);
      const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] as number;
      this.after(delay, () => {
        if (this.listeners.size > 0) this.retry(href);
        else this.retriesDue.add(href);
      });
    }
    this.settleOne(href);
    this.notify();
  }

  private retry(href: string): void {
    if (this.released || !this.failed.delete(href)) return;
    this.placeholderShown.add(href);
    this.notify();
    this.start(href);
  }

  private stepFades(): void {
    if (this.fadeTimer !== undefined || this.released) return;
    this.fadeTimer = setTimeout(() => {
      this.fadeTimer = undefined;
      for (const [href, since] of this.fadingSince) {
        if (now() - since >= FADE_MS) this.fadingSince.delete(href);
      }
      this.notify();
      if (this.fadingSince.size > 0) this.stepFades();
    }, FADE_STEP_MS);
  }

  private settleOne(href: string): void {
    if (this.unsettled.delete(href) && this.unsettled.size === 0) this.settle();
  }

  private after(delay: number, run: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.released) run();
    }, delay);
    this.timers.add(timer);
  }

  private notify(): void {
    if (this.released) return;
    for (const listener of [...this.listeners]) listener();
  }
}

/**
 * An image read that failed for a reason that can pass: the host's shard
 * loader threw, or the shard still had not arrived after its loads. A read
 * the engine refused, and every failure after a read (an unsupported
 * format, a budget, a decode), is final.
 */
export class BrowserReaderCanvasTransientImageRead extends Error {
  constructor(cause: unknown) {
    super(`reader session image read can be retried: ${String(cause)}`, { cause });
    this.name = 'BrowserReaderCanvasTransientImageRead';
  }
}

/** Wraps a failed image read that can pass; returns any other failure as it is. */
export function classifyImageReadFailure(error: unknown): unknown {
  const code = (error as { readonly code?: unknown } | null)?.code;
  return typeof code !== 'string' || code === 'resource-pending'
    ? new BrowserReaderCanvasTransientImageRead(error)
    : error;
}

/** Whether a read failed because the session no longer holds the artifact it was made through. */
export function readThroughReleasedArtifact(error: unknown): boolean {
  return (error as { readonly code?: unknown } | null)?.code === 'unknown-artifact';
}

function isRetryable(error: unknown): boolean {
  return error instanceof BrowserReaderCanvasTransientImageRead;
}

function recordImageFailure(href: string, error: unknown): void {
  const scope = globalThis as { __ritoImageFailures?: unknown[] };
  scope.__ritoImageFailures = [
    ...(scope.__ritoImageFailures ?? []).slice(-19),
    { href, error: String(error).slice(0, 400), at: new Date().toISOString() },
  ];
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
