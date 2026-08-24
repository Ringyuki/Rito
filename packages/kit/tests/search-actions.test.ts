import { describe, expect, it, vi } from 'vitest';
import type { Reader } from '@ritojs/core';
import { buildSearchActions } from '../src/controller/facade/search-actions';
import type { Internals, Nav, RuntimeComponents } from '../src/controller/facade/types';
import type { ReaderControllerEvents } from '../src/controller/types';
import { createCoordinatorState } from '../src/controller/core';
import { wireEngineEvents } from '../src/controller/wiring/engine-events';
import { createSearchEngine, type SearchResult } from '../src/interaction';
import { createDisposableCollection } from '../src/utils/disposable';
import { createEmitter } from '../src/utils/event-emitter';

describe('native search actions', () => {
  it('contains a synchronous reader search failure and clears stale results', async () => {
    const fixture = createFixture(() => {
      throw new Error('sync native search failure');
    });
    fixture.engine.setResults([result('stale')]);

    expect(() => {
      fixture.actions.search('query');
    }).not.toThrow();
    await settleTasks();

    expect(fixture.actions.searchResults).toEqual([]);
    expect(fixture.errors).toEqual([
      { message: 'sync native search failure', source: 'reader-search' },
    ]);
  });

  it('keeps resolved results and contains a throwing publication listener', async () => {
    const resolved = result('resolved');
    const fixture = createFixture(() => Promise.resolve([resolved]));
    fixture.engine.onResultsChange(() => {
      throw new Error('consumer search results failure');
    });

    fixture.actions.search('query');
    await settleTasks();

    expect(fixture.actions.searchResults).toEqual([resolved]);
    expect(fixture.errors).toEqual([
      { message: 'consumer search results failure', source: 'reader-search-publication' },
    ]);
  });

  it('contains an error listener that throws while reporting publication failure', async () => {
    const fixture = createFixture(() => Promise.resolve([result('resolved')]));
    fixture.engine.onResultsChange(() => {
      throw new Error('consumer search results failure');
    });
    fixture.emitter.on('error', () => {
      throw new Error('consumer error listener failure');
    });

    fixture.actions.search('query');
    await settleTasks();

    expect(fixture.actions.searchResults).toHaveLength(1);
  });

  it('drops a pending result and rejects retained searches after controller disposal', async () => {
    const pending = deferred<readonly SearchResult[]>();
    const search = vi.fn(() => pending.promise);
    const fixture = createFixture(search);

    fixture.actions.search('pending');
    fixture.coordState.nativeInteractionsAlive = false;
    pending.resolve([result('stale')]);
    await settleTasks();
    fixture.actions.search('retained');

    expect(fixture.actions.searchResults).toEqual([]);
    expect(search).toHaveBeenCalledTimes(1);
  });
});

describe('search engine event containment', () => {
  it('finishes active-state notification and redraw when a public results listener throws', () => {
    const engine = createSearchEngine();
    const emitter = createEmitter<ReaderControllerEvents>();
    const active = vi.fn<(event: ReaderControllerEvents['searchActiveChange']) => void>();
    const errors = vi.fn<(event: ReaderControllerEvents['error']) => void>();
    const markAllOverlaysDirty = vi.fn();
    emitter.on('searchResults', () => {
      throw new Error('consumer search results failure');
    });
    emitter.on('searchActiveChange', active);
    emitter.on('error', errors);
    const deps = {
      reader: { spreads: [] },
      engines: {
        search: engine,
        selection: {
          dispose: vi.fn(),
          onError: vi.fn(() => () => undefined),
          onSelectionChange: vi.fn(() => () => undefined),
        },
        position: null,
      },
      coordState: createCoordinatorState(),
      emitter,
      frameDriver: { markAllOverlaysDirty },
      getCurrentSpread: () => 0,
    } as unknown as Parameters<typeof wireEngineEvents>[0];
    const disposables = createDisposableCollection();
    wireEngineEvents(deps, disposables);
    const resolved = result('resolved');

    expect(() => {
      engine.setResults([resolved]);
    }).not.toThrow();

    expect(engine.getActiveIndex()).toBe(0);
    expect(active).toHaveBeenCalledWith({ activeIndex: 0, result: resolved });
    expect(markAllOverlaysDirty).toHaveBeenCalledTimes(2);
    expect(errors).toHaveBeenCalledWith({
      message: 'consumer search results failure',
      source: 'search-results-listener',
    });
    disposables.disposeAll();
  });
});

function createFixture(search: Reader['search']) {
  const engine = createSearchEngine();
  const coordState = createCoordinatorState();
  const emitter = createEmitter<ReaderControllerEvents>();
  const errors: ReaderControllerEvents['error'][] = [];
  emitter.on('error', (event) => {
    errors.push(event);
  });
  const internals = {
    reader: { search },
    currentSpread: 0,
    engines: { search: engine },
    coordState,
  } as unknown as Internals;
  const actions = buildSearchActions(internals, emitter, {} as Nav, {} as RuntimeComponents);
  return { actions, coordState, emitter, engine, errors };
}

function result(context: string): SearchResult {
  return {
    pageIndex: 0,
    range: {
      start: { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: 0 },
      end: { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: context.length },
    },
    context,
  };
}

async function settleTasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function deferred<T>() {
  let resolve = (_value: T): void => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
