// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Reader, ReaderInteractions, ReaderPageSemantics, Spread } from '@ritojs/core';
import { createCoordinatorState } from '../src/controller/core';
import { wireA11y } from '../src/controller/wiring/a11y';
import { dispatchImageResourceClick } from '../src/controller/wiring/image-click';
import type { WiringDeps } from '../src/controller/core/wiring-deps';
import { createDisposableCollection } from '../src/utils/disposable';

const bounds = { x: 0, y: 0, width: 100, height: 40 };

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('native accessibility wiring', () => {
  it('loads the initial visible spread from the native semantic capability', async () => {
    const fixture = createFixture((_pageIndex) =>
      Promise.resolve(pageSemantics('native paragraph')),
    );
    wireA11y(fixture.deps, fixture.disposables);
    await settle();

    expect(fixture.getPageSemantics).toHaveBeenCalledWith(0);
    expect(document.body.querySelector('[role="document"]')?.textContent).toBe('native paragraph');
  });

  it('reloads the committed spread after its rendered notification and rejects the superseded read', async () => {
    let readCount = 0;
    let resolveSuperseded!: (value: ReaderPageSemantics) => void;
    const superseded = new Promise<ReaderPageSemantics>((done) => {
      resolveSuperseded = done;
    });
    const fixture = createFixture(() => {
      readCount += 1;
      if (readCount === 1) return Promise.resolve(pageSemantics('initial paragraph'));
      if (readCount === 2) return superseded;
      return Promise.resolve(pageSemantics('committed paragraph'));
    });
    wireA11y(fixture.deps, fixture.disposables);
    await settle();

    expect(document.body.querySelector('[role="document"]')?.textContent).toBe('initial paragraph');

    fixture.spreadRendered?.(0, fixture.spread);
    fixture.layoutCommitted?.(0);
    await settle();
    resolveSuperseded(pageSemantics('superseded paragraph'));
    await settle();

    expect(fixture.getPageSemantics).toHaveBeenCalledTimes(3);
    expect(document.body.querySelector('[role="document"]')?.textContent).toBe(
      'committed paragraph',
    );
    expect(fixture.emit).not.toHaveBeenCalled();
  });

  it('treats present-but-disabled native semantics as authoritative over legacy content', () => {
    const fixture = createFixture(() => Promise.resolve(pageSemantics('native paragraph')), false);
    fixture.spread.left = {
      ...fixture.spread.left,
      content: [
        {
          type: 'layout-block',
          semanticTag: 'p',
          bounds,
          children: [
            {
              type: 'line-box',
              bounds,
              runs: [{ type: 'text-run', text: 'legacy paragraph', bounds }],
            },
          ],
        },
      ],
    };
    wireA11y(fixture.deps, fixture.disposables);

    expect(fixture.getPageSemantics).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="document"]')?.textContent).toBe('');
  });

  it('routes mirrored links through revision-bound native targets', async () => {
    const fixture = createFixture(() => Promise.resolve(linkSemantics()));
    fixture.getPageTargets.mockResolvedValue({
      pageIndex: 0,
      spreadIndex: 0,
      targets: [
        {
          kind: 'link',
          href: 'https://example.com',
          label: 'Example',
          bounds,
        },
      ],
    });
    wireA11y(fixture.deps, fixture.disposables);
    await settle();

    document.body
      .querySelector('[role="document"] a')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle();

    expect(fixture.getPageTargets).toHaveBeenCalledWith(0);
    expect(fixture.emit).toHaveBeenCalledWith(
      'linkClick',
      expect.objectContaining({ href: 'https://example.com', type: 'external' }),
    );
  });

  it('rejects page targets that do not belong to the mirrored page and spread', async () => {
    const fixture = createFixture(() => Promise.resolve(linkSemantics()));
    fixture.getPageTargets.mockResolvedValue({
      pageIndex: 1,
      spreadIndex: 0,
      targets: [
        {
          kind: 'link',
          href: 'https://example.com',
          label: 'Example',
          bounds,
        },
      ],
    });
    wireA11y(fixture.deps, fixture.disposables);
    await settle();

    document.body
      .querySelector('[role="document"] a')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle();

    expect(fixture.emit).not.toHaveBeenCalledWith('linkClick', expect.anything());
    expect(fixture.emit).toHaveBeenCalledWith('error', {
      message: 'Native page targets do not match the accessibility mirror',
      source: 'native-a11y-activation',
    });
  });

  it('contains a throwing link listener on the mirrored activation path', async () => {
    const fixture = createFixture(() => Promise.resolve(linkSemantics()));
    fixture.getPageTargets.mockResolvedValue({
      pageIndex: 0,
      spreadIndex: 0,
      targets: [
        {
          kind: 'link',
          href: 'https://example.com',
          label: 'Example',
          bounds,
        },
      ],
    });
    fixture.emit.mockImplementation((event: string) => {
      if (event === 'linkClick') throw new Error('consumer link listener failure');
    });
    wireA11y(fixture.deps, fixture.disposables);
    await settle();

    document.body
      .querySelector('[role="document"] a')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle();

    expect(fixture.emit).toHaveBeenCalledWith('error', {
      message: 'consumer link listener failure',
      source: 'native-link-publication',
    });
  });

  it('supersedes a pending image as soon as a mirrored target is activated', async () => {
    const pending = deferred<string | undefined>();
    const fixture = createFixture(() => Promise.resolve(linkSemantics()));
    fixture.getImageBlobUrl.mockReturnValue(pending.promise);
    fixture.getPageTargets.mockResolvedValue({
      pageIndex: 0,
      spreadIndex: 0,
      targets: [
        {
          kind: 'link',
          href: 'https://example.com',
          label: 'Example',
          bounds,
        },
      ],
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { revokeObjectURL });
    wireA11y(fixture.deps, fixture.disposables);
    await settle();
    const mapper = fixture.coordState.mapper;
    if (!mapper) throw new Error('Missing fixture mapper');

    dispatchImageResourceClick(
      { src: 'cover.jpg', alt: 'Cover', screenBounds: bounds },
      mapper,
      fixture.deps,
    );
    document.body
      .querySelector('[role="document"] a')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    pending.resolve('blob:stale-a11y');
    await settle();

    expect(fixture.emit).not.toHaveBeenCalledWith('imageClick', expect.anything());
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:stale-a11y');
  });

  it('contains a synchronous semantic read failure when the error listener throws', async () => {
    let shouldFail = true;
    const fixture = createFixture(() => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error('sync semantics failure');
      }
      return Promise.resolve(pageSemantics('recovered paragraph'));
    });
    fixture.emit.mockImplementation((event: string) => {
      if (event === 'error') throw new Error('consumer error listener failure');
    });

    wireA11y(fixture.deps, fixture.disposables);
    await settle();
    fixture.emit.mockImplementation(() => undefined);
    fixture.spreadRendered?.(0, fixture.spread);
    await settle();

    expect(fixture.getPageSemantics).toHaveBeenCalledTimes(2);
    expect(document.body.querySelector('[role="document"]')?.textContent).toBe(
      'recovered paragraph',
    );
  });
});

function createFixture(read: (pageIndex: number) => Promise<ReaderPageSemantics>, enabled = true) {
  const getPageSemantics = vi.fn(read);
  const getPageTargets = vi.fn<ReaderInteractions['getPageTargets']>();
  const interactions = {
    enabled,
    getPageSemantics,
    getPageTargets,
  } as unknown as ReaderInteractions;
  const getImageBlobUrl = vi.fn<Reader['getImageBlobUrl']>(() => undefined);
  const spread: Spread & { left: NonNullable<Spread['left']> } = {
    index: 0,
    left: { index: 0, bounds, content: [] },
  };
  let spreadRendered: ((index: number, spread: Spread) => void) | undefined;
  let layoutCommitted: ((activeSpreadIndex: number) => void) | undefined;
  const reader = {
    spreads: [spread],
    interactions,
    getImageBlobUrl,
    onSpreadRendered(callback: (index: number, value: Spread) => void) {
      spreadRendered = callback;
      return () => {
        spreadRendered = undefined;
      };
    },
    onLayoutCommitted(callback: (activeSpreadIndex: number) => void) {
      layoutCommitted = callback;
      return () => {
        layoutCommitted = undefined;
      };
    },
  } as unknown as Reader;
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const emit = vi.fn();
  const coordState = createCoordinatorState();
  coordState.mapper = {
    pageContentToScreen: () => bounds,
    spreadContentToPage: () => ({ pageIndex: 0, x: 0, y: 0 }),
  } as never;
  const deps = {
    reader,
    canvas,
    options: { a11y: { enabled: true, container: document.body } },
    emitter: { emit },
    coordState,
    getCurrentSpread: () => 0,
  } as unknown as WiringDeps;
  const disposables = createDisposableCollection();
  return {
    deps,
    disposables,
    emit,
    coordState,
    getImageBlobUrl,
    getPageSemantics,
    getPageTargets,
    spread,
    get spreadRendered() {
      return spreadRendered;
    },
    get layoutCommitted() {
      return layoutCommitted;
    },
  };
}

function pageSemantics(text: string): ReaderPageSemantics {
  return {
    pageIndex: 0,
    spreadIndex: 0,
    nodes: [{ role: 'paragraph', text, bounds, children: [] }],
  };
}

function linkSemantics(): ReaderPageSemantics {
  return {
    pageIndex: 0,
    spreadIndex: 0,
    nodes: [
      {
        role: 'link',
        text: 'Example',
        href: 'https://example.com',
        bounds,
        children: [],
      },
    ],
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
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
