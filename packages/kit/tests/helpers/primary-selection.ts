import { vi, type Mock } from 'vitest';
import type {
  PrimarySelectionDragNavigation,
  PrimarySelectionDragSession,
  PrimarySelectionInputIntent,
} from '../../src/controller/wiring/selection-drag';

export type PrimarySelectionDragSessionMock = Omit<
  PrimarySelectionDragSession,
  'update' | 'finish' | 'cancel' | 'owns' | 'wasSuperseded' | 'didNavigate'
> & {
  readonly update: Mock<PrimarySelectionDragSession['update']>;
  readonly finish: Mock<PrimarySelectionDragSession['finish']>;
  readonly cancel: Mock<PrimarySelectionDragSession['cancel']>;
  readonly owns: Mock<PrimarySelectionDragSession['owns']>;
  readonly wasSuperseded: Mock<PrimarySelectionDragSession['wasSuperseded']>;
  readonly didNavigate: Mock<PrimarySelectionDragSession['didNavigate']>;
};

export function primarySelectionDragSession(
  navigated = false,
  owns: () => boolean = () => true,
  wasSuperseded: () => boolean = () => !owns(),
  ownsCancellation: () => boolean = owns,
): PrimarySelectionDragSessionMock {
  return {
    update: vi.fn(),
    finish: vi.fn(owns),
    cancel: vi.fn(ownsCancellation),
    owns: vi.fn(owns),
    wasSuperseded: vi.fn(wasSuperseded),
    didNavigate: vi.fn(() => navigated),
  };
}

export function primarySelectionNavigation(
  session: PrimarySelectionDragSession,
): PrimarySelectionDragNavigation & {
  readonly claim: Mock<PrimarySelectionDragNavigation['claim']>;
  readonly begin: Mock<PrimarySelectionDragNavigation['begin']>;
} {
  const input: PrimarySelectionInputIntent = { owns: () => true };
  const claim = vi.fn<PrimarySelectionDragNavigation['claim']>(() => input);
  const begin = vi.fn<PrimarySelectionDragNavigation['begin']>((_input, start) => {
    start();
    return session;
  });
  return { begin, claim };
}
