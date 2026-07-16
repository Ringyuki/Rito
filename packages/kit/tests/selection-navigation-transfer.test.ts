import { describe, expect, it, vi } from 'vitest';
import type { Reader, Spread } from '@ritojs/core';
import { createNavigation, type NavigationDeps } from '../src/controller/navigation';

const spreads: readonly Spread[] = [0, 1].map((index) => ({
  index,
  left: {
    index,
    bounds: { x: 0, y: 0, width: 300, height: 400 },
    content: [],
  },
}));

describe('selection projection navigation scope', () => {
  it('clears the outer transfer when a same-target navigation supersedes it', () => {
    let transfer: object | null = null;
    let reentered = false;
    const observedTransfer: boolean[] = [];
    let reenterNavigation = (): void => undefined;
    const fixture = navigationFixture({
      onContentInteractionIntent: () => {
        transfer = null;
      },
      beginSelectionProjectionTransfer: () => {
        const token = {};
        transfer = token;
        return () => {
          if (transfer === token) transfer = null;
        };
      },
      onNotify: () => {
        observedTransfer.push(transfer !== null);
        if (reentered) return;
        reentered = true;
        reenterNavigation();
      },
    });
    const nav = fixture.nav;
    reenterNavigation = () => {
      nav.jumpToSpread(1, true);
    };

    expect(nav.prepareSpreadForJump(1)).toBe('ready');
    expect(nav.jumpToSpreadIfReady(1, true)).toBe('superseded');

    expect(observedTransfer).toEqual([true, false]);
    expect(transfer).toBeNull();
  });

  it('cleans up the transfer when an active-spread listener throws', () => {
    let transfer: object | null = null;
    const fixture = navigationFixture({
      beginSelectionProjectionTransfer: () => {
        const token = {};
        transfer = token;
        return () => {
          if (transfer === token) transfer = null;
        };
      },
      onNotify: () => {
        throw new Error('listener failed');
      },
    });

    expect(fixture.nav.prepareSpreadForJump(1)).toBe('ready');
    expect(() => fixture.nav.jumpToSpreadIfReady(1, true)).toThrow('listener failed');
    expect(transfer).toBeNull();
  });

  it('prepares an unavailable frame without claiming navigation ownership', () => {
    const onNavigationIntent = vi.fn();
    const onContentInteractionIntent = vi.fn();
    const fixture = navigationFixture({
      ready: false,
      onNavigationIntent,
      onContentInteractionIntent,
    });

    expect(fixture.nav.prepareSpreadForJump(1)).toBe('not-ready');

    expect(onNavigationIntent).not.toHaveBeenCalled();
    expect(onContentInteractionIntent).not.toHaveBeenCalled();
    expect(fixture.getCurrentSpread()).toBe(0);
  });

  it('clears a transfer when a portable position supersedes navigation ownership', () => {
    let transfer: object | null = {};
    const fixture = navigationFixture({
      onContentInteractionIntent: () => {
        transfer = null;
      },
    });

    fixture.nav.supersedeForPositionIntent();

    expect(transfer).toBeNull();
  });
});

interface NavigationFixtureOptions {
  readonly ready?: boolean;
  readonly onNavigationIntent?: () => void;
  readonly onContentInteractionIntent?: () => void;
  readonly beginSelectionProjectionTransfer?: (spreadIndex: number) => () => void;
  readonly onNotify?: (spreadIndex: number) => void;
}

function navigationFixture(options: NavigationFixtureOptions) {
  let currentSpread = 0;
  const slots = new Map<number, string>();
  const reader = {
    totalSpreads: spreads.length,
    spreads,
    notifyActiveSpread: (spreadIndex: number) => {
      options.onNotify?.(spreadIndex);
    },
  } as unknown as Reader;
  const deps = {
    getReader: () => reader,
    getCurrentSpread: () => currentSpread,
    setCurrentSpread: (spreadIndex: number) => {
      currentSpread = spreadIndex;
    },
    emitter: { emit: vi.fn() },
    td: { isAnimating: false },
    frameDriver: { scheduleComposite: vi.fn() },
    pool: {
      getSlotFor: (spreadIndex: number) => slots.get(spreadIndex) ?? null,
      assignSlot: (slot: string, spreadIndex: number) => {
        slots.set(spreadIndex, slot);
      },
      ensureContent: vi.fn(() => options.ready !== false),
      jump: vi.fn(),
      rotateForward: vi.fn(),
      rotateBackward: vi.fn(),
    },
    contentRenderer: vi.fn(),
    onNavigationIntent: options.onNavigationIntent,
    onContentInteractionIntent: options.onContentInteractionIntent,
    beginSelectionProjectionTransfer: options.beginSelectionProjectionTransfer,
  } as unknown as NavigationDeps;
  return {
    nav: createNavigation(deps),
    getCurrentSpread: () => currentSpread,
  };
}
