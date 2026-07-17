import type { ReaderLocatorResolution } from '@ritojs/core';
import type { PositionIntent, ResolvedPositionIntent } from './intent';
import type { PositionLayout, ReadingPosition } from './model';
import {
  positionFromResolution,
  supportsNativePosition,
  type PositionLocatorNavigator,
  type PositionInteractions,
} from './native';

type PortableSignal = 'layout' | 'cancel';

interface SignalWaiter {
  readonly intent: PositionIntent;
  readonly resolve: (signal: PortableSignal) => void;
}

interface SignalWait {
  readonly promise: Promise<PortableSignal>;
  readonly cancel: () => void;
}

type LocatorAttempt =
  | { readonly kind: 'resolution'; readonly value: ReaderLocatorResolution | undefined }
  | { readonly kind: 'signal'; readonly value: PortableSignal };

interface AtomicNavigation {
  readonly controller: AbortController;
}

type AtomicAttempt =
  | { readonly kind: 'resolution'; readonly value: ReaderLocatorResolution | undefined }
  | { readonly kind: 'abort' };

export class PortablePositionResolver {
  private layoutEpoch = 0;
  private atomicNavigation: AtomicNavigation | undefined;
  private readonly signalWaiters = new Set<SignalWaiter>();

  constructor(
    private readonly getLayout: () => PositionLayout,
    private readonly getInteractions: () => PositionInteractions | undefined,
    private readonly owns: (intent: PositionIntent) => boolean,
    private readonly navigator?: PositionLocatorNavigator,
  ) {}

  noteLayoutCommit(): void {
    this.layoutEpoch += 1;
    this.signalAll('layout');
  }

  cancel(): void {
    const navigation = this.atomicNavigation;
    this.atomicNavigation = undefined;
    this.signalAll('cancel');
    navigation?.controller.abort();
  }

  async navigate(
    position: ReadingPosition,
    intent: PositionIntent,
  ): Promise<ResolvedPositionIntent | undefined> {
    if (this.navigator && position.sourceLocator) {
      return this.navigateAtomically(position, intent, this.navigator);
    }
    return this.resolve(position, intent);
  }

  async resolve(
    position: ReadingPosition,
    intent: PositionIntent,
  ): Promise<ResolvedPositionIntent | undefined> {
    let observedEpoch = this.layoutEpoch;
    let waitForLayout = false;
    while (this.owns(intent)) {
      if (waitForLayout) {
        const signal = await this.waitForSignal(intent, observedEpoch).promise;
        if (signal === 'cancel') return undefined;
        observedEpoch = this.layoutEpoch;
      }
      const attempt = await this.raceLocatorAttempt(position, intent, observedEpoch);
      if (attempt.kind === 'signal') {
        if (attempt.value === 'cancel') return undefined;
        observedEpoch = this.layoutEpoch;
        waitForLayout = false;
        continue;
      }
      if (!this.owns(intent)) return undefined;
      if (attempt.value?.status === 'resolved') {
        return {
          intent,
          position: positionFromResolution(position, attempt.value, this.getLayout()),
        };
      }
      if (attempt.value?.status !== 'pending' || attempt.value.reason !== 'notPaginated') {
        return undefined;
      }
      waitForLayout = true;
    }
    return undefined;
  }

  private async navigateAtomically(
    position: ReadingPosition,
    intent: PositionIntent,
    navigator: PositionLocatorNavigator,
  ): Promise<ResolvedPositionIntent | undefined> {
    if (!position.sourceLocator || !this.owns(intent)) return undefined;
    const navigation = { controller: new AbortController() };
    const previousNavigation = this.atomicNavigation;
    this.atomicNavigation = navigation;
    previousNavigation?.controller.abort();
    if (this.atomicNavigation !== navigation || !this.owns(intent)) {
      if (this.atomicNavigation === navigation) {
        this.atomicNavigation = undefined;
        navigation.controller.abort();
      }
      return undefined;
    }
    try {
      const attempt = await raceAtomicNavigation(
        navigator(position.sourceLocator, navigation.controller.signal),
        navigation.controller.signal,
      );
      if (attempt.kind === 'abort') return undefined;
      const resolution = attempt.value;
      if (!this.owns(intent) || navigation.controller.signal.aborted) return undefined;
      if (resolution?.status !== 'resolved') return undefined;
      return {
        intent,
        position: positionFromResolution(position, resolution, this.getLayout()),
      };
    } catch (error) {
      if (!this.owns(intent) || navigation.controller.signal.aborted) return undefined;
      throw error;
    } finally {
      if (this.atomicNavigation === navigation) this.atomicNavigation = undefined;
    }
  }

  private async raceLocatorAttempt(
    position: ReadingPosition,
    intent: PositionIntent,
    observedEpoch: number,
  ): Promise<LocatorAttempt> {
    const interactions = this.getInteractions();
    if (!supportsNativePosition(interactions) || !position.sourceLocator) {
      return { kind: 'resolution', value: undefined };
    }
    const signal = this.waitForSignal(intent, observedEpoch);
    try {
      return await Promise.race([
        interactions
          .resolveLocator(position.sourceLocator)
          .then((value): LocatorAttempt => ({ kind: 'resolution', value })),
        signal.promise.then((value): LocatorAttempt => ({ kind: 'signal', value })),
      ]);
    } finally {
      signal.cancel();
    }
  }

  private waitForSignal(intent: PositionIntent, observedEpoch: number): SignalWait {
    if (!this.owns(intent)) return resolvedSignal('cancel');
    if (observedEpoch !== this.layoutEpoch) return resolvedSignal('layout');
    let waiter: SignalWaiter | undefined;
    const promise = new Promise<PortableSignal>((resolve) => {
      waiter = { intent, resolve };
      this.signalWaiters.add(waiter);
    });
    return {
      promise,
      cancel: () => {
        if (waiter) this.signalWaiters.delete(waiter);
      },
    };
  }

  private signalAll(signal: PortableSignal): void {
    for (const waiter of this.signalWaiters) {
      this.signalWaiters.delete(waiter);
      waiter.resolve(signal === 'layout' && this.owns(waiter.intent) ? 'layout' : 'cancel');
    }
  }
}

function resolvedSignal(signal: PortableSignal): SignalWait {
  return { promise: Promise.resolve(signal), cancel: () => undefined };
}

function raceAtomicNavigation(
  operation: Promise<ReaderLocatorResolution | undefined>,
  signal: AbortSignal,
): Promise<AtomicAttempt> {
  const resolution = operation.then((value): AtomicAttempt => ({ kind: 'resolution', value }));
  let onAbort!: () => void;
  const abort = new Promise<AtomicAttempt>((resolve) => {
    onAbort = () => {
      resolve({ kind: 'abort' });
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  return Promise.race([resolution, abort]).finally(() => {
    signal.removeEventListener('abort', onAbort);
  });
}
