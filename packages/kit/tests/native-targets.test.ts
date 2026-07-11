import { describe, expect, it, vi } from 'vitest';
import { createLayoutConfig } from '@ritojs/core';
import type { Page, Reader, ReaderInteractions, ReaderPageTargets, Spread } from '@ritojs/core';
import { createCoordinatorState } from '../src/controller/core';
import { createCoordinateMapper } from '../src/controller/geometry/coordinate-mapper';
import {
  findNativeTargetAtPos,
  invalidateNativeTargets,
  loadNativeTargetsForSpread,
} from '../src/controller/wiring/native-targets';

const leftPage: Page = {
  index: 6,
  bounds: { x: 0, y: 0, width: 300, height: 400 },
  content: [],
};
const rightPage: Page = {
  index: 7,
  bounds: { x: 0, y: 0, width: 300, height: 400 },
  content: [],
};
const spread: Spread = {
  index: 3,
  left: leftPage,
  right: rightPage,
};

describe('native visible-spread target loading', () => {
  it('installs a double-page target set atomically', async () => {
    const left = deferred<ReaderPageTargets | undefined>();
    const right = deferred<ReaderPageTargets | undefined>();
    const interactions = interactionsFor((pageIndex) =>
      pageIndex === 6 ? left.promise : right.promise,
    );
    const state = createCoordinatorState();
    const task = loadNativeTargetsForSpread(spread, readerWith(interactions), state);

    left.resolve(pageTargets(6, 'left'));
    await Promise.resolve();
    expect(state.nativeTargetsByPage.size).toBe(0);

    right.resolve(pageTargets(7, 'right'));
    await task;
    expect([...state.nativeTargetsByPage.keys()]).toEqual([6, 7]);
  });

  it('does not let an older spread read replace a newer one', async () => {
    const old = deferred<ReaderPageTargets | undefined>();
    const currentSpread: Spread = { index: 4, left: { ...leftPage, index: 8 } };
    const interactions = interactionsFor((pageIndex) =>
      pageIndex === 6 ? old.promise : Promise.resolve(pageTargets(8, 'current', 4)),
    );
    const reader = readerWith(interactions);
    const state = createCoordinatorState();
    const oldTask = loadNativeTargetsForSpread({ index: 3, left: leftPage }, reader, state);
    await loadNativeTargetsForSpread(currentSpread, reader, state);

    old.resolve(pageTargets(6, 'old'));
    await oldTask;
    expect([...state.nativeTargetsByPage.keys()]).toEqual([8]);
  });

  it('suppresses an obsolete spread error after a newer load wins', async () => {
    const old = deferred<ReaderPageTargets | undefined>();
    const interactions = interactionsFor((pageIndex) =>
      pageIndex === 6 ? old.promise : Promise.resolve(pageTargets(8, 'current', 4)),
    );
    const reader = readerWith(interactions);
    const state = createCoordinatorState();
    const oldTask = loadNativeTargetsForSpread({ index: 3, left: leftPage }, reader, state);
    await loadNativeTargetsForSpread({ index: 4, left: { ...leftPage, index: 8 } }, reader, state);

    old.reject(new Error('obsolete worker failure'));
    await expect(oldTask).resolves.toBeUndefined();
    expect([...state.nativeTargetsByPage.keys()]).toEqual([8]);
  });

  it('discards a read when interaction becomes disabled mid-flight', async () => {
    const result = deferred<ReaderPageTargets | undefined>();
    let enabled = true;
    const interactions = interactionsFor(
      () => result.promise,
      () => enabled,
    );
    const state = createCoordinatorState();
    const task = loadNativeTargetsForSpread(
      { index: 3, left: leftPage },
      readerWith(interactions),
      state,
    );

    enabled = false;
    result.resolve(pageTargets(6, 'stale'));
    await task;
    expect(state.nativeTargetsByPage.size).toBe(0);
  });

  it('invalidates installed targets and outstanding reads together', async () => {
    const result = deferred<ReaderPageTargets | undefined>();
    const state = createCoordinatorState();
    state.nativeTargetsByPage.set(2, []);
    const task = loadNativeTargetsForSpread(
      { index: 3, left: leftPage },
      readerWith(interactionsFor(() => result.promise)),
      state,
    );

    invalidateNativeTargets(state);
    result.resolve(pageTargets(6, 'stale'));
    await task;
    expect(state.nativeTargetsByPage.size).toBe(0);
  });

  it('hit-tests actionable targets in reverse paint order and ignores text', () => {
    const state = createCoordinatorState();
    state.mapper = {
      spreadContentToPage: () => ({ pageIndex: 6, x: 15, y: 15 }),
    } as never;
    state.nativeTargetsByPage.set(6, [
      target('link', 'under'),
      target('text', 'text'),
      target('footnote', 'over'),
    ]);

    expect(findNativeTargetAtPos({ x: 15, y: 15 }, state)?.target.label).toBe('over');
  });

  it('maps a double-spread right-page click back into page-content coordinates', () => {
    const state = createCoordinatorState();
    state.mapper = createCoordinateMapper(
      createLayoutConfig({
        width: 620,
        height: 400,
        margin: 20,
        spread: 'double',
        spreadGap: 20,
      }),
      spread,
      1,
    );
    state.nativeTargetsByPage.set(7, [target('link', 'right')]);
    const rightOrigin = state.mapper.getPage(7)?.spreadContentOriginX;
    if (rightOrigin === undefined) throw new Error('right page geometry missing');

    expect(findNativeTargetAtPos({ x: rightOrigin + 15, y: 15 }, state)).toMatchObject({
      pageIndex: 7,
      target: { label: 'right' },
    });
  });
});

function interactionsFor(
  getPageTargets: (pageIndex: number) => Promise<ReaderPageTargets | undefined>,
  enabled: () => boolean = () => true,
): ReaderInteractions {
  return {
    get enabled() {
      return enabled();
    },
    getPageTargets: vi.fn(getPageTargets),
    getFootnote: vi.fn(),
    resolveLocator: vi.fn(),
  };
}

function readerWith(interactions: ReaderInteractions): Reader {
  return { interactions } as Reader;
}

function pageTargets(pageIndex: number, label: string, spreadIndex = 3): ReaderPageTargets {
  return { pageIndex, spreadIndex, targets: [target('link', label)] };
}

function target(kind: 'text' | 'link' | 'footnote', label: string) {
  return {
    kind,
    label,
    bounds: { x: 10, y: 10, width: 20, height: 20 },
    ...(kind === 'footnote' ? { href: '#note', footnoteKey: 'chapter.xhtml#note' } : {}),
  } as const;
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
