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
  captureNativeSpreadPosition,
  supportsNativePosition,
  withPortableLocator,
  type NativePositionInteractions,
  type PositionInteractions,
  type PositionLocatorNavigator,
} from './native';
import { registerPreservingIntentClaim } from './preserving-intent';
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
    registerPreservingIntentClaim(this, () => this.claimPositionIntent(true));
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
    const intent = this.claimIntent();
    if (this.owns(intent)) this.publish(createReadingPosition(this.getLayout(), spreadIndex));
  }

  project(position: ReadingPosition): ReadingPosition {
    return projectReadingPosition(position, this.getLayout());
  }

  setCurrent(position: ReadingPosition): void {
    const intent = this.claimIntent();
    if (this.owns(intent)) this.publish(position);
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
    return this.claimPositionIntent(false);
  }
  private claimPositionIntent(preserveCurrent: boolean): PositionIntent {
    const intent = { generation: ++this.generation };
    const previousController = this.intentController;
    const controller = new AbortController();
    this.intentController = controller;
    this.pending = null;
    this.pendingCaptureSpread = null;
    this.portableIntent = null;
    if (!preserveCurrent) this.currentIsSerializable = false;
    registerPositionIntentSupersession(intent, controller.signal);
    previousController?.abort();
    if (this.generation === intent.generation) this.portableResolver.cancel();
    return intent;
  }
  claimPortableIntent(): PositionIntent {
    const intent = this.claimIntent();
    if (this.owns(intent)) this.portableIntent = intent;
    return intent;
  }

  cancelPortableIntent(intent: PositionIntent): boolean {
    if (!this.owns(intent)) return false;
    return this.owns(this.claimIntent());
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
    const intent = this.claimIntent();
    return this.owns(intent)
      ? { kind: 'legacy', intent, position: preserved }
      : { kind: 'portable' };
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
    const intent = this.claimPositionIntent(true);
    if (this.generation !== intent.generation) return;
    const controller = this.intentController;
    this.intentController = undefined;
    this.generation += 1;
    controller?.abort();
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
    if (!this.owns(intent)) return;
    this.pendingCaptureSpread = spreadIndex;
    const task = captureNativeSpreadPosition(
      this.getLayout,
      spreadIndex,
      interactions,
      () => this.owns(intent),
      (position) => {
        if (this.owns(intent)) this.publish(position);
      },
    )
      .catch(ignoreResult)
      .then(() => {
        if (this.owns(intent)) this.pendingCaptureSpread = null;
      });
    if (this.owns(intent)) this.track(task);
  }

  private async resolvePortable(
    position: ReadingPosition,
    intent: PositionIntent,
    navigate = true,
  ): Promise<ResolvedPositionIntent | undefined> {
    const operation = navigate
      ? this.portableResolver.navigate(position, intent)
      : this.portableResolver.resolve(position, intent);
    const tracked = operation.then(ignoreResult, ignoreResult);
    if (this.owns(intent)) this.track(tracked);
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
    if (!this.owns(intent)) return true;
    const operation = this.resolvePortable(portable, intent, false).then(
      (resolved) => {
        if (resolved) this.commit(resolved.intent, resolved.position);
        else if (this.cancelPortableIntent(intent)) this.update(spreadIndex);
      },
      () => {
        if (this.cancelPortableIntent(intent)) this.update(spreadIndex);
      },
    );
    if (this.owns(intent)) this.track(operation);
    return true;
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
