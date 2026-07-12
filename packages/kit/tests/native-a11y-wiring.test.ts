// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Reader, ReaderInteractions, ReaderPageSemantics, Spread } from '@ritojs/core';
import { wireA11y } from '../src/controller/wiring/a11y';
import type { WiringDeps } from '../src/controller/core/wiring-deps';
import { createDisposableCollection } from '../src/utils/disposable';

const bounds = { x: 0, y: 0, width: 100, height: 40 };

afterEach(() => {
  document.body.replaceChildren();
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

  it('clears committed semantics and rejects an old read after a layout commit', async () => {
    let resolve!: (value: ReaderPageSemantics) => void;
    const pending = new Promise<ReaderPageSemantics>((done) => {
      resolve = done;
    });
    const fixture = createFixture(async () => pending);
    wireA11y(fixture.deps, fixture.disposables);

    fixture.layoutCommitted?.();
    resolve(pageSemantics('stale paragraph'));
    await settle();

    expect(document.body.querySelector('[role="document"]')?.textContent).toBe('');
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
});

function createFixture(read: (pageIndex: number) => Promise<ReaderPageSemantics>, enabled = true) {
  const getPageSemantics = vi.fn(read);
  const getPageTargets = vi.fn<ReaderInteractions['getPageTargets']>();
  const interactions = {
    enabled,
    getPageSemantics,
    getPageTargets,
  } as unknown as ReaderInteractions;
  const spread: { left: NonNullable<Spread['left']>; right?: Spread['right']; index: number } = {
    index: 0,
    left: { index: 0, bounds, content: [] },
  };
  let spreadRendered: ((index: number, spread: Spread) => void) | undefined;
  let layoutCommitted: (() => void) | undefined;
  const reader = {
    spreads: [spread],
    interactions,
    onSpreadRendered(callback: (index: number, value: Spread) => void) {
      spreadRendered = callback;
      return () => {
        spreadRendered = undefined;
      };
    },
    onLayoutCommitted(callback: () => void) {
      layoutCommitted = callback;
      return () => {
        layoutCommitted = undefined;
      };
    },
  } as unknown as Reader;
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const emit = vi.fn();
  const deps = {
    reader,
    canvas,
    options: { a11y: { enabled: true, container: document.body } },
    emitter: { emit },
    getCurrentSpread: () => 0,
  } as unknown as WiringDeps;
  const disposables = createDisposableCollection();
  return {
    deps,
    disposables,
    emit,
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
}
