import type { CoreReaderPrimitiveList } from './core-contracts';
import { renderReaderPrimitivesToCanvas, type CanvasRenderingTarget } from './primitive-renderer';
import type { BrowserReaderArtifactV1, BrowserReaderV1Session } from './reader-v1';
import { convertReaderRubyV1, convertReaderTextV1 } from './reader-v1-canvas-converter';
import { BrowserReaderCanvasUnsupportedErrorV1 } from './reader-v1-canvas-error';
import {
  BrowserReaderCanvasResourceOwnerV1,
  type BrowserReaderCanvasArtifactResourcesV1,
} from './reader-v1-canvas-resources';

export { BrowserReaderCanvasUnsupportedErrorV1 } from './reader-v1-canvas-error';

export type BrowserReaderCanvasTargetV1 = CanvasRenderingTarget;

export interface BrowserReaderCanvasPaintOptionsV1 {
  readonly foregroundColor?: string | undefined;
  readonly backgroundColor?: string | undefined;
  readonly clear?: boolean | undefined;
}

export interface BrowserReaderPreparedCanvasArtifactV1 {
  readonly artifact: BrowserReaderArtifactV1;
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

export interface BrowserReaderCanvasPresenterV1 {
  /**
   * Resolves only after every referenced font and image is ready. For a new
   * foreground candidate, the host must then verify it is still latest, call
   * session.adoptForegroundCandidate, and only paint after that ACK succeeds.
   * A preparation failure must release the Core candidate without adopting it.
   */
  prepare(artifact: BrowserReaderArtifactV1): Promise<BrowserReaderPreparedCanvasArtifactV1>;
  /** Paints a prepared artifact only after the host has received its adoption ACK. */
  paint(
    prepared: BrowserReaderPreparedCanvasArtifactV1,
    target: BrowserReaderCanvasTargetV1,
    options?: BrowserReaderCanvasPaintOptionsV1,
  ): void;
  /** Browser resources only; the host still owns session.dispose(). */
  dispose(): void;
}

export function createBrowserReaderV1CanvasPresenter(
  session: BrowserReaderV1Session,
): BrowserReaderCanvasPresenterV1 {
  return new CanvasPresenter(session);
}

class CanvasPresenter implements BrowserReaderCanvasPresenterV1 {
  private readonly owner = Symbol('reader-v1-canvas-presenter');
  private readonly resources: BrowserReaderCanvasResourceOwnerV1;
  private readonly prepared = new Set<PreparedCanvasArtifact>();
  private disposed = false;

  constructor(session: BrowserReaderV1Session) {
    this.resources = new BrowserReaderCanvasResourceOwnerV1(session);
  }

  async prepare(artifact: BrowserReaderArtifactV1): Promise<BrowserReaderPreparedCanvasArtifactV1> {
    this.assertOpen();
    const list = artifact.displayList.displayList;
    // Everything the paint cannot express fails here, before any resource
    // is loaded or a wrong frame committed; the paint itself then only
    // blits what the engine resolved.
    validateReaderPrimitivesV1(list);
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
    prepared: BrowserReaderPreparedCanvasArtifactV1,
    target: BrowserReaderCanvasTargetV1,
    options: BrowserReaderCanvasPaintOptionsV1 = {},
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
    if (this.disposed) throw new Error('Browser Reader v1 Canvas presenter is disposed.');
  }
}

class PreparedCanvasArtifact implements BrowserReaderPreparedCanvasArtifactV1 {
  disposed = false;

  constructor(
    readonly owner: symbol,
    readonly artifact: BrowserReaderArtifactV1,
    readonly list: CoreReaderPrimitiveList,
    readonly resources: BrowserReaderCanvasArtifactResourcesV1,
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
function validateReaderPrimitivesV1(list: CoreReaderPrimitiveList): void {
  let stateDepth = 0;
  for (const primitive of list.commands) {
    if (primitive.kind === 'push-state') stateDepth += 1;
    if (primitive.kind === 'pop-state') {
      if (stateDepth === 0) {
        throw new BrowserReaderCanvasUnsupportedErrorV1('display-state:unmatched-pop');
      }
      stateDepth -= 1;
    }
    if (primitive.kind === 'text') convertReaderTextV1(primitive);
    if (primitive.kind === 'ruby') convertReaderRubyV1(primitive);
  }
  if (stateDepth !== 0) {
    throw new BrowserReaderCanvasUnsupportedErrorV1('display-state:unclosed-push');
  }
}

function requirePreparedArtifact(
  value: BrowserReaderPreparedCanvasArtifactV1,
  owner: symbol,
): PreparedCanvasArtifact {
  if (!(value instanceof PreparedCanvasArtifact) || value.owner !== owner) {
    throw new Error('Prepared Reader v1 artifact belongs to another Canvas presenter.');
  }
  if (value.disposed) throw new Error('Prepared Reader v1 Canvas artifact is disposed.');
  return value;
}

function assertRequiredImages(
  list: CoreReaderPrimitiveList,
  resources: BrowserReaderCanvasArtifactResourcesV1,
): void {
  for (const primitive of list.commands) {
    if (primitive.kind === 'draw-image' && !resources.hasImage(primitive.src)) {
      throw new Error(`Reader v1 artifact omitted required image resource ${primitive.src}.`);
    }
  }
}

function clearTarget(target: BrowserReaderCanvasTargetV1): void {
  const context = target as CanvasRenderingContext2D;
  context.save();
  try {
    context.resetTransform();
    context.clearRect(0, 0, target.canvas.width, target.canvas.height);
  } finally {
    context.restore();
  }
}
