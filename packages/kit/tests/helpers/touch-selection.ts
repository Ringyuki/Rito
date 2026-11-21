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
  readonly fingerDown: Mock<TransitionDriver['fingerDown']>;
  readonly fingerUp: Mock<TransitionDriver['fingerUp']>;
  readonly fingerCancel: Mock<TransitionDriver['fingerCancel']>;
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
  const fingerDown = vi.fn<TransitionDriver['fingerDown']>();
  const fingerUp = vi.fn<TransitionDriver['fingerUp']>();
  const fingerCancel = vi.fn<TransitionDriver['fingerCancel']>();
  const scheduleComposite = vi.fn();
  const td = {
    get isAnimating() {
      return isAnimating();
    },
    viewportWidth: 300,
    spine: 0,
    physics: undefined,
    fingerDown,
    fingerMove: vi.fn(),
    fingerUp,
    fingerCancel,
  } as unknown as TransitionDriver;
  const frameDriver = { scheduleComposite } as unknown as FrameDriver;
  const deps: GestureDeps = {
    td,
    frameDriver,
    claimForFinger: vi.fn(),
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
    fingerDown,
    fingerUp,
    fingerCancel,
    disposables,
  };
}
