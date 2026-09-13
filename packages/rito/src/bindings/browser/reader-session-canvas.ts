import type { CoreReaderPrimitiveList } from './core-contracts';
import { renderReaderPrimitivesToCanvas, type CanvasRenderingTarget } from './primitive-renderer';
import type { BrowserReaderArtifact, BrowserReaderSession } from './reader-session';
import { convertReaderRuby, convertReaderText } from './reader-session-canvas-converter';
import { BrowserReaderCanvasUnsupportedError } from './reader-session-canvas-error';
import {
  BrowserReaderCanvasResourceOwner,
  type BrowserReaderCanvasArtifactResources,
} from './reader-session-canvas-resources';

export { BrowserReaderCanvasUnsupportedError } from './reader-session-canvas-error';

export type BrowserReaderCanvasTarget = CanvasRenderingTarget;

export interface BrowserReaderCanvasPaintOptions {
  readonly foregroundColor?: string | undefined;
  readonly backgroundColor?: string | undefined;
  readonly clear?: boolean | undefined;
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
  /** Releases only browser-side decoded resources, never the Core artifact. */
  dispose(): void;
}

export interface BrowserReaderCanvasPresenter {
  /**
   * Resolves only after every referenced font and image is ready. For a new
   * foreground candidate, the host must then verify it is still latest, call
   * session.adoptForegroundCandidate, and only paint after that ACK succeeds.
   * A preparation failure must release the Core candidate without adopting it.
   */
  prepare(artifact: BrowserReaderArtifact): Promise<BrowserReaderPreparedCanvasArtifact>;
  /** Paints a prepared artifact only after the host has received its adoption ACK. */
  paint(
    prepared: BrowserReaderPreparedCanvasArtifact,
    target: BrowserReaderCanvasTarget,
    options?: BrowserReaderCanvasPaintOptions,
  ): void;
  /** Browser resources only; the host still owns session.dispose(). */
  dispose(): void;
}

export function createBrowserReaderSessionCanvasPresenter(
  session: BrowserReaderSession,
): BrowserReaderCanvasPresenter {
  return new CanvasPresenter(session);
}

class CanvasPresenter implements BrowserReaderCanvasPresenter {
  private readonly owner = Symbol('reader-session-canvas-presenter');
  private readonly resources: BrowserReaderCanvasResourceOwner;
  private readonly prepared = new Set<PreparedCanvasArtifact>();
  private disposed = false;

  constructor(session: BrowserReaderSession) {
    this.resources = new BrowserReaderCanvasResourceOwner(session);
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
      assertRequiredImages(list, resources);
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
    if (options.clear !== false) clearTarget(target);
    renderReaderPrimitivesToCanvas(owned.list, target, {
      ...(options.foregroundColor === undefined
        ? {}
        : { foregroundColor: options.foregroundColor }),
      ...(options.backgroundColor === undefined
        ? {}
        : { backgroundColor: options.backgroundColor }),
      resolveImage: (href) => owned.resources.resolveImage(href),
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

function assertRequiredImages(
  list: CoreReaderPrimitiveList,
  resources: BrowserReaderCanvasArtifactResources,
): void {
  for (const primitive of list.commands) {
    if (primitive.kind === 'draw-image' && !resources.hasImage(primitive.src)) {
      throw new Error(`reader session artifact omitted required image resource ${primitive.src}.`);
    }
  }
}

function clearTarget(target: BrowserReaderCanvasTarget): void {
  const context = target as CanvasRenderingContext2D;
  context.save();
  try {
    context.resetTransform();
    context.clearRect(0, 0, target.canvas.width, target.canvas.height);
  } finally {
    context.restore();
  }
}
