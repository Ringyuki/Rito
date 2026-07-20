import type { CoreFrameCommand } from './core-contracts';
import { renderFrameCommandsToCanvas, type CanvasRenderingTarget } from './frame-command-renderer';
import type { BrowserReaderArtifactV1, BrowserReaderV1Session } from './reader-v1';
import { convertReaderDisplayCommandsV1 } from './reader-v1-canvas-converter';
import {
  BrowserReaderCanvasResourceOwnerV1,
  type BrowserReaderCanvasArtifactResourcesV1,
} from './reader-v1-canvas-resources';

export { BrowserReaderCanvasUnsupportedErrorV1 } from './reader-v1-canvas-error';

export type BrowserReaderCanvasTargetV1 = CanvasRenderingTarget;

export interface BrowserReaderCanvasPrepareOptionsV1 {
  /** Physical output pixels per Reader v1 layout pixel. Defaults to one. */
  readonly pixelRatio?: number | undefined;
}

export interface BrowserReaderCanvasPaintOptionsV1 {
  /** Must match the ratio used to prepare the artifact, when provided. */
  readonly pixelRatio?: number | undefined;
  readonly foregroundColor?: string | undefined;
  readonly backgroundColor?: string | undefined;
  readonly clear?: boolean | undefined;
}

export interface BrowserReaderPreparedCanvasArtifactV1 {
  readonly artifact: BrowserReaderArtifactV1;
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
  prepare(
    artifact: BrowserReaderArtifactV1,
    options?: BrowserReaderCanvasPrepareOptionsV1,
  ): Promise<BrowserReaderPreparedCanvasArtifactV1>;
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

  async prepare(
    artifact: BrowserReaderArtifactV1,
    options: BrowserReaderCanvasPrepareOptionsV1 = {},
  ): Promise<BrowserReaderPreparedCanvasArtifactV1> {
    this.assertOpen();
    const pixelRatio = normalizePixelRatio(options.pixelRatio);
    const commands = convertReaderDisplayCommandsV1(artifact.displayList.displayList.commands);
    const resources = await this.resources.prepare(artifact, commands, pixelRatio);
    try {
      assertRequiredImages(commands, resources);
      this.assertOpen();
      const prepared = new PreparedCanvasArtifact(
        this.owner,
        artifact,
        pixelRatio,
        commands,
        resources,
        (value) => this.prepared.delete(value),
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
    const pixelRatio = options.pixelRatio ?? owned.pixelRatio;
    if (pixelRatio !== owned.pixelRatio) {
      throw new Error('Reader v1 Canvas paint pixelRatio must match artifact preparation.');
    }
    if (options.clear !== false) clearTarget(target);
    renderFrameCommandsToCanvas(owned.commands, target, {
      pixelRatio,
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
    readonly pixelRatio: number,
    readonly commands: readonly CoreFrameCommand[],
    readonly resources: BrowserReaderCanvasArtifactResourcesV1,
    private readonly onDispose: (value: PreparedCanvasArtifact) => void,
  ) {}

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
  commands: readonly CoreFrameCommand[],
  resources: BrowserReaderCanvasArtifactResourcesV1,
): void {
  for (const command of commands) {
    const href =
      command.kind === 'paintImage'
        ? command.src
        : command.kind === 'paintBlock'
          ? command.paint.background?.image
          : undefined;
    if (href !== undefined && !resources.hasImage(href)) {
      throw new Error(`Reader v1 artifact omitted required image resource ${href}.`);
    }
  }
}

function normalizePixelRatio(value: number | undefined): number {
  const pixelRatio = value ?? 1;
  if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) {
    throw new RangeError('Reader v1 Canvas pixelRatio must be positive and finite.');
  }
  return pixelRatio;
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
