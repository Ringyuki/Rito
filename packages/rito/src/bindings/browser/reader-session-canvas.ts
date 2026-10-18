import type { ReaderGlTarget } from './gl-pen/target';
import type { CoreReaderPrimitiveList } from './core-contracts';
import { renderReaderPrimitivesToGl } from './gl-pen/pen';
import {
  renderReaderPrimitivesToCanvas,
  type CanvasRenderingTarget,
  type PrimitiveRenderOptions,
} from './primitive-renderer';
import type { BrowserReaderArtifact, BrowserReaderSession } from './reader-session';
import { convertReaderRuby, convertReaderText } from './reader-session-canvas-converter';
import { BrowserReaderCanvasUnsupportedError } from './reader-session-canvas-error';
import {
  BrowserReaderCanvasResourceOwner,
  type BrowserReaderCanvasFontOptions,
  type BrowserReaderCanvasArtifactResources,
} from './reader-session-canvas-resources';

export { BrowserReaderCanvasUnsupportedError } from './reader-session-canvas-error';

export type BrowserReaderCanvasTarget = CanvasRenderingTarget;

export interface BrowserReaderCanvasPaintOptions {
  readonly foregroundColor?: string | undefined;
  readonly backgroundColor?: string | undefined;
  /** What the cleared target is filled with first; none leaves it clear. */
  readonly ground?: string | undefined;
  /**
   * Target device pixels per device pixel of the artifact's grid: 1 on it,
   * any other (a host zoom) paints it uniformly scaled.
   */
  readonly scale?: number | undefined;
}

export interface BrowserReaderPreparedCanvasArtifact {
  readonly artifact: BrowserReaderArtifact;
  /**
   * Device pixels per CSS pixel the artifact's paint is resolved at (the
   * `renderRatio` of the request that produced it). The target canvas
   * must be sized on that grid: `round(width × ratio)` by
   * `round(height × ratio)` device pixels, painted with an identity
   * transform.
   */
  readonly ratio: number;
  readonly disposed: boolean;
  /**
   * Calls `listener` whenever what the artifact paints for its images
   * changes (one landing, a placeholder appearing, a late image fading
   * in); paint the artifact again on each call. Returns the unsubscribe.
   * A failed image is read again while something listens.
   */
  onImagesChanged(listener: () => void): () => void;
  /** Settles once every image has landed or failed; a page never waits for it. */
  readonly imagesSettled: Promise<void>;
  /** Releases only browser-side decoded resources, never the Core artifact. */
  dispose(): void;
}

export interface BrowserReaderCanvasPresenter {
  /**
   * Resolves once every referenced font is ready; images land afterwards
   * and announce themselves through `onImagesChanged`, so a page never
   * waits for them. For a new foreground candidate, the host must then
   * verify it is still latest, call session.adoptForegroundCandidate, and
   * only paint after that ACK succeeds. A preparation failure must release
   * the Core candidate without adopting it.
   */
  prepare(artifact: BrowserReaderArtifact): Promise<BrowserReaderPreparedCanvasArtifact>;
  /**
   * Paints a prepared artifact over the cleared target, only after the
   * host has received its adoption ACK.
   */
  paint(
    prepared: BrowserReaderPreparedCanvasArtifact,
    target: BrowserReaderCanvasTarget,
    options?: BrowserReaderCanvasPaintOptions,
  ): void;
  /**
   * Paints a prepared artifact into a WebGL2 framebuffer, pixel for pixel
   * as `paint` would on a canvas. Answers false when the context is lost.
   */
  paintGl(
    prepared: BrowserReaderPreparedCanvasArtifact,
    target: ReaderGlTarget,
    options?: BrowserReaderCanvasPaintOptions,
  ): boolean;
  /** Browser resources only; the host still owns session.dispose(). */
  dispose(): void;
}

/**
 * `hostFont`: host faces the page registers itself. For a font an artifact
 * paints with, the face returned is waited for instead of being read back
 * out of the engine, and its registration stays the page's: the presenter
 * never removes it. Undefined leaves the font to the presenter.
 *
 * `fontRejected`: told of a publication face the browser refused to decode,
 * so the host can have the engine lay out without it.
 */
export type BrowserReaderCanvasPresenterOptions = BrowserReaderCanvasFontOptions;

export function createBrowserReaderSessionCanvasPresenter(
  session: BrowserReaderSession,
  options: BrowserReaderCanvasPresenterOptions = {},
): BrowserReaderCanvasPresenter {
  return new CanvasPresenter(session, options);
}

class CanvasPresenter implements BrowserReaderCanvasPresenter {
  private readonly owner = Symbol('reader-session-canvas-presenter');
  private readonly resources: BrowserReaderCanvasResourceOwner;
  private readonly prepared = new Set<PreparedCanvasArtifact>();
  private disposed = false;

  constructor(session: BrowserReaderSession, options: BrowserReaderCanvasPresenterOptions) {
    this.resources = new BrowserReaderCanvasResourceOwner(session, options);
  }

  async prepare(artifact: BrowserReaderArtifact): Promise<BrowserReaderPreparedCanvasArtifact> {
    this.assertOpen();
    const list = artifact.displayList.displayList;
    // Everything the paint cannot express fails here, before any resource
    // is loaded or a wrong frame committed; the paint itself then only
    // blits what the engine resolved.
    validateReaderPrimitives(list);
    const resources = await this.resources.prepare(artifact, list);
    try {
      this.assertOpen();
      const prepared = new PreparedCanvasArtifact(this.owner, artifact, list, resources, (value) =>
        this.prepared.delete(value),
      );
      this.prepared.add(prepared);
      return prepared;
    } catch (error: unknown) {
      resources.release();
      throw error;
    }
  }

  paint(
    prepared: BrowserReaderPreparedCanvasArtifact,
    target: BrowserReaderCanvasTarget,
    options: BrowserReaderCanvasPaintOptions = {},
  ): void {
    this.assertOpen();
    const owned = requirePreparedArtifact(prepared, this.owner);
    const context = target as CanvasRenderingContext2D;
    context.save();
    try {
      context.resetTransform();
      context.clearRect(0, 0, target.canvas.width, target.canvas.height);
      if (options.ground) {
        context.fillStyle = options.ground;
        context.fillRect(0, 0, target.canvas.width, target.canvas.height);
      }
      const scale = options.scale ?? 1;
      if (scale !== 1) context.scale(scale, scale);
      renderReaderPrimitivesToCanvas(owned.list, target, renderOptions(owned, options));
    } finally {
      context.restore();
    }
  }

  paintGl(
    prepared: BrowserReaderPreparedCanvasArtifact,
    target: ReaderGlTarget,
    options: BrowserReaderCanvasPaintOptions = {},
  ): boolean {
    this.assertOpen();
    const owned = requirePreparedArtifact(prepared, this.owner);
    return renderReaderPrimitivesToGl(owned.list, target, {
      ...renderOptions(owned, options),
      ground: options.ground,
      scale: options.scale ?? 1,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const failures: unknown[] = [];
    for (const prepared of [...this.prepared]) {
      try {
        prepared.dispose();
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    try {
      this.resources.dispose();
    } catch (error: unknown) {
      failures.push(error);
    }
    if (failures.length) throw new AggregateError(failures, 'Canvas presenter disposal failed.');
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error('Browser reader session Canvas presenter is disposed.');
  }
}

class PreparedCanvasArtifact implements BrowserReaderPreparedCanvasArtifact {
  disposed = false;

  constructor(
    readonly owner: symbol,
    readonly artifact: BrowserReaderArtifact,
    readonly list: CoreReaderPrimitiveList,
    readonly resources: BrowserReaderCanvasArtifactResources,
    private readonly onDispose: (value: PreparedCanvasArtifact) => void,
  ) {}

  get ratio(): number {
    return this.list.ratio;
  }

  onImagesChanged(listener: () => void): () => void {
    return this.resources.onImagesChanged(listener);
  }

  get imagesSettled(): Promise<void> {
    return this.resources.imagesSettled;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.resources.release();
    } finally {
      this.onDispose(this);
    }
  }
}

/** Rejects a list the paint cannot express: an unbalanced state stack, or
 * a text run whose colour space or border style the canvas has no
 * spelling for. */
function validateReaderPrimitives(list: CoreReaderPrimitiveList): void {
  let stateDepth = 0;
  for (const primitive of list.commands) {
    if (primitive.kind === 'push-state') stateDepth += 1;
    if (primitive.kind === 'pop-state') {
      if (stateDepth === 0) {
        throw new BrowserReaderCanvasUnsupportedError('display-state:unmatched-pop');
      }
      stateDepth -= 1;
    }
    if (primitive.kind === 'text') convertReaderText(primitive);
    if (primitive.kind === 'ruby') convertReaderRuby(primitive);
  }
  if (stateDepth !== 0) {
    throw new BrowserReaderCanvasUnsupportedError('display-state:unclosed-push');
  }
}

function renderOptions(
  owned: PreparedCanvasArtifact,
  options: {
    readonly foregroundColor?: string | undefined;
    readonly backgroundColor?: string | undefined;
  },
): PrimitiveRenderOptions {
  return {
    ...(options.foregroundColor === undefined ? {} : { foregroundColor: options.foregroundColor }),
    ...(options.backgroundColor === undefined ? {} : { backgroundColor: options.backgroundColor }),
    resolveImage: (href) => owned.resources.resolveImage(href),
    imageFallback: (href) => owned.resources.imageFallback(href),
    imageOpacity: (href) => owned.resources.imageOpacity(href),
  };
}

function requirePreparedArtifact(
  value: BrowserReaderPreparedCanvasArtifact,
  owner: symbol,
): PreparedCanvasArtifact {
  if (!(value instanceof PreparedCanvasArtifact) || value.owner !== owner) {
    throw new Error('Prepared reader session artifact belongs to another Canvas presenter.');
  }
  if (value.disposed) throw new Error('Prepared reader session Canvas artifact is disposed.');
  return value;
}
