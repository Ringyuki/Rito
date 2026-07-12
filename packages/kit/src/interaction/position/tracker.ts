import {
  createReadingPosition,
  projectReadingPosition,
  resolveReadingPosition,
  type PositionLayout,
  type ReadingPosition,
} from './model';
import {
  registerPositionIntentSupersession,
  type LayoutPositionPlan,
  type PositionIntent,
  type PositionTracker,
  type ResolvedPositionIntent,
} from './intent';
import {
  positionFromAnchor,
  spreadPageIndexes,
  supportsNativePosition,
  withPortableLocator,
  type NativePositionInteractions,
  type PositionInteractions,
  type PositionLocatorNavigator,
} from './native';
import { parsePosition } from './parse';
import { PortablePositionResolver } from './portable-resolution';

export type {
  LayoutPositionPlan,
  PositionIntent,
  PositionTracker,
  ResolvedPositionIntent,
} from './intent';

export function createPositionTracker(
  getLayout: () => PositionLayout,
  getInteractions: () => PositionInteractions | undefined = () => undefined,
  navigator?: PositionLocatorNavigator,
): PositionTracker {
  return new PositionTrackerRuntime(getLayout, getInteractions, navigator);
}

class PositionTrackerRuntime implements PositionTracker {
  private current: ReadingPosition | null = null;
  private currentIsSerializable = false;
  private generation = 0;
  private alive = true;
  private pending: Promise<void> | null = null;
  private pendingCaptureSpread: number | null = null;
  private portableIntent: PositionIntent | null = null;
  private intentController: AbortController | undefined;
  private readonly listeners = new Set<(position: ReadingPosition) => void>();
  private readonly portableResolver: PortablePositionResolver;

  constructor(
    private readonly getLayout: () => PositionLayout,
    private readonly getInteractions: () => PositionInteractions | undefined,
    private readonly navigator?: PositionLocatorNavigator,
  ) {
    this.portableResolver = new PortablePositionResolver(
      getLayout,
      getInteractions,
      (intent) => this.owns(intent),
      navigator,
    );
  }

  update(spreadIndex: number): void {
    if (this.hasPortableIntent()) return;
    const interactions = this.getInteractions();
    if (supportsNativePosition(interactions)) {
      if (this.shouldKeepNativePosition(spreadIndex)) return;
      this.captureNative(spreadIndex, interactions);
      return;
    }
    this.claimIntent();
    this.publish(createReadingPosition(this.getLayout(), spreadIndex));
  }

  project(position: ReadingPosition): ReadingPosition {
    return projectReadingPosition(position, this.getLayout());
  }

  setCurrent(position: ReadingPosition): void {
    this.claimIntent();
    this.publish(position);
  }

  getCurrent(): ReadingPosition | null {
    return this.current;
  }

  getPreservableCurrent(): ReadingPosition | null {
    return this.currentIsSerializable ? this.current : null;
  }

  resolve(position: ReadingPosition): number | undefined {
    return resolveReadingPosition(position, this.getLayout());
  }

  claimIntent(): PositionIntent {
    this.cancelAsyncIntent();
    this.currentIsSerializable = false;
    const intent = { generation: ++this.generation };
    const controller = new AbortController();
    this.intentController = controller;
    registerPositionIntentSupersession(intent, controller.signal);
    return intent;
  }

  claimPortableIntent(): PositionIntent {
    const intent = this.claimIntent();
    this.portableIntent = intent;
    return intent;
  }

  cancelPortableIntent(intent: PositionIntent): boolean {
    if (!this.owns(intent)) return false;
    this.claimIntent();
    return true;
  }

  owns(intent: PositionIntent): boolean {
    return this.alive && intent.generation === this.generation;
  }

  async resolveForNavigation(
    position: ReadingPosition,
    requestedIntent?: PositionIntent,
  ): Promise<ResolvedPositionIntent | undefined> {
    const layout = this.getLayout();
    const portable = withPortableLocator(position, layout);
    const interactions = this.getInteractions();
    const native =
      portable !== undefined &&
      (this.navigator !== undefined || supportsNativePosition(interactions));
    const intent = requestedIntent ?? (native ? this.claimPortableIntent() : this.claimIntent());
    if (!this.owns(intent)) return undefined;
    if (!native) {
      if (this.portableIntent === intent) this.portableIntent = null;
      return { intent, position: this.project(position) };
    }
    this.portableIntent = intent;
    return this.resolvePortable(portable, intent);
  }

  commit(intent: PositionIntent, position: ReadingPosition): boolean {
    if (!this.owns(intent)) return false;
    this.portableIntent = null;
    this.publish(position);
    return this.owns(intent);
  }

  prepareLayoutCommit(
    position: ReadingPosition | null | undefined,
    committedSpreadIndex: number,
  ): LayoutPositionPlan {
    this.portableResolver.noteLayoutCommit();
    const preserved = position === undefined ? this.getPreservableCurrent() : position;
    if (this.hasPortableIntent()) return { kind: 'portable' };
    if (preserved && this.startLayoutProjection(preserved, committedSpreadIndex)) {
      return { kind: 'portable' };
    }
    return { kind: 'legacy', intent: this.claimIntent(), position: preserved };
  }

  async settle(): Promise<void> {
    while (this.pending) await this.pending;
  }

  serialize(): string | undefined {
    return this.current && this.currentIsSerializable ? JSON.stringify(this.current) : undefined;
  }

  async restore(serialized: string, requestedIntent?: PositionIntent): Promise<number | undefined> {
    const parsed = parsePosition(serialized);
    if (!parsed) return undefined;
    const resolved = await this.resolveForNavigation(parsed, requestedIntent);
    if (!resolved || !this.commit(resolved.intent, resolved.position)) return undefined;
    return resolved.position.projection.spreadIndex;
  }

  invalidate(): void {
    this.cancelAsyncIntent();
    this.generation += 1;
  }

  dispose(): void {
    this.alive = false;
    this.invalidate();
    this.currentIsSerializable = false;
    this.listeners.clear();
  }

  onPositionChange(listener: (position: ReadingPosition) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private hasPortableIntent(): boolean {
    return this.portableIntent !== null && this.owns(this.portableIntent);
  }

  private shouldKeepNativePosition(spreadIndex: number): boolean {
    return (
      this.pendingCaptureSpread === spreadIndex ||
      (this.currentIsSerializable &&
        this.current?.sourceLocator !== undefined &&
        this.current.projection.spreadIndex === spreadIndex)
    );
  }

  private captureNative(spreadIndex: number, interactions: NativePositionInteractions): void {
    const intent = this.claimIntent();
    this.pendingCaptureSpread = spreadIndex;
    const task = this.captureSpreadPages(spreadIndex, interactions, intent)
      .catch(ignoreResult)
      .then(() => {
        if (this.owns(intent)) this.pendingCaptureSpread = null;
      });
    this.track(task);
  }

  private async captureSpreadPages(
    spreadIndex: number,
    interactions: NativePositionInteractions,
    intent: PositionIntent,
  ): Promise<void> {
    for (const pageIndex of spreadPageIndexes(this.getLayout(), spreadIndex)) {
      const anchor = await interactions.getPageReadingAnchor(pageIndex);
      if (!this.owns(intent) || anchor === undefined) return;
      if (anchor.status === 'resolved') {
        this.publish(positionFromAnchor(anchor, this.getLayout()));
        return;
      }
    }
  }

  private async resolvePortable(
    position: ReadingPosition,
    intent: PositionIntent,
    navigate = true,
  ): Promise<ResolvedPositionIntent | undefined> {
    const operation = navigate
      ? this.portableResolver.navigate(position, intent)
      : this.portableResolver.resolve(position, intent);
    this.track(operation.then(ignoreResult, ignoreResult));
    try {
      const resolved = await operation;
      if (!resolved && this.owns(intent)) this.portableIntent = null;
      return resolved;
    } catch (error) {
      if (!this.owns(intent)) return undefined;
      this.portableIntent = null;
      throw error;
    }
  }

  private startLayoutProjection(position: ReadingPosition, spreadIndex: number): boolean {
    const portable = withPortableLocator(position, this.getLayout());
    if (!portable || !supportsNativePosition(this.getInteractions())) return false;
    const intent = this.claimPortableIntent();
    const operation = this.resolvePortable(portable, intent, false).then(
      (resolved) => {
        if (resolved) this.commit(resolved.intent, resolved.position);
        else if (this.cancelPortableIntent(intent)) this.update(spreadIndex);
      },
      () => {
        if (this.cancelPortableIntent(intent)) this.update(spreadIndex);
      },
    );
    this.track(operation);
    return true;
  }

  private cancelAsyncIntent(): void {
    this.intentController?.abort();
    this.intentController = undefined;
    this.portableResolver.cancel();
    this.pending = null;
    this.pendingCaptureSpread = null;
    this.portableIntent = null;
  }

  private publish(position: ReadingPosition): void {
    if (!this.alive) return;
    this.current = position;
    this.currentIsSerializable = true;
    for (const listener of this.listeners) listener(position);
  }

  private track(task: Promise<void>): void {
    this.pending = task;
    void task.then(() => {
      if (this.pending === task) this.pending = null;
    });
  }
}

function ignoreResult(): void {}
