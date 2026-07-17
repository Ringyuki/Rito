import { vi, type Mock } from 'vitest';
import type { InteractionModeManager } from '../../src/controller/interaction-mode/index';
import { wireUnifiedTouchHandler, type GestureDeps } from '../../src/controller/wiring/gesture';
import type { PrimarySelectionDragNavigation } from '../../src/controller/wiring/selection-drag';
import type { FrameDriver } from '../../src/driver/frame-driver';
import type { TransitionDriver } from '../../src/driver/transition-driver';
import { createDisposableCollection, type DisposableCollection } from '../../src/utils/disposable';
import {
  createDomTarget,
  createSelectionHarness,
  type DomHarness,
  type SelectionHarness,
} from './dom-input';

export interface TouchSelectionHarness {
  readonly dom: DomHarness;
  readonly selection: SelectionHarness;
  readonly tap: Mock<(position: { x: number; y: number }) => void>;
  readonly setMode: Mock<InteractionModeManager['setMode']>;
  readonly cancelTracking: Mock<TransitionDriver['cancelTracking']>;
  readonly releaseTracking: Mock<TransitionDriver['releaseTracking']>;
  readonly startGestureNavigation: Mock<GestureDeps['startGestureNavigation']>;
  readonly disposables: DisposableCollection;
}

export function createTouchSelectionHarness(
  selectionNavigation?: PrimarySelectionDragNavigation,
  toContent: (value: Touch) => { x: number; y: number } = (value) => ({
    x: value.clientX,
    y: value.clientY,
  }),
  isAnimating: () => boolean = () => false,
): TouchSelectionHarness {
  const dom = createDomTarget();
  const selection = createSelectionHarness();
  const tap = vi.fn<(position: { x: number; y: number }) => void>();
  const setMode = vi.fn<InteractionModeManager['setMode']>();
  const cancelTracking = vi.fn<TransitionDriver['cancelTracking']>(() => true);
  const cancelGestureNavigation = vi.fn();
  const releaseTracking = vi.fn<TransitionDriver['releaseTracking']>(() => 'cancel');
  const scheduleComposite = vi.fn();
  const td = {
    get isAnimating() {
      return isAnimating();
    },
    cancelTracking,
    releaseTracking,
    startTracking: vi.fn(),
    updateTracking: vi.fn(),
    interrupt: vi.fn(),
    forceSettle: vi.fn(() => 0),
    onSettled: vi.fn(() => () => {}),
  } as unknown as TransitionDriver;
  const frameDriver = { scheduleComposite } as unknown as FrameDriver;
  const startGestureNavigation = vi.fn<GestureDeps['startGestureNavigation']>(
    (_index: number, onTransitionStart: () => void) => {
      onTransitionStart();
      return { cancel: cancelGestureNavigation };
    },
  );
  const deps: GestureDeps = {
    td,
    frameDriver,
    startGestureNavigation,
    getCurrentSpread: () => 0,
    getTotalSpreads: () => 3,
    isPaginationComplete: () => true,
    commitPendingTransition: vi.fn(),
  };
  const modeManager = {
    mode: 'gesture',
    setMode,
    onModeChange: () => () => {},
  } as InteractionModeManager;
  const disposables = createDisposableCollection();
  wireUnifiedTouchHandler(
    dom.target,
    deps,
    selection.engine,
    modeManager,
    toContent,
    tap,
    disposables,
    selectionNavigation,
  );
  return {
    dom,
    selection,
    tap,
    setMode,
    cancelTracking,
    releaseTracking,
    startGestureNavigation,
    disposables,
  };
}
