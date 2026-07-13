import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Reader, ReaderInteractionTarget, ReaderInteractions } from '@ritojs/core';
import { createCoordinatorState } from '../src/controller/core';
import type { WiringDeps } from '../src/controller/core';
import type { ReaderControllerEvents } from '../src/controller/types';
import { dispatchClick } from '../src/controller/wiring/click-dispatch';
import { releaseImageClickResources } from '../src/controller/wiring/image-click';
import { createEmitter } from '../src/utils/event-emitter';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('image click resource resolution', () => {
  it.each(['native', 'legacy'] as const)(
    'waits for the first asynchronous %s image URL before opening the UI',
    async (mode) => {
      const pending = deferred<string | undefined>();
      const fixture = createFixture(
        mode,
        vi.fn(() => pending.promise),
      );

      dispatchClick(clickPoint, fixture.deps);
      expect(fixture.imageClick).not.toHaveBeenCalled();

      pending.resolve('blob:cover');
      await settleTasks();

      expect(fixture.imageClick).toHaveBeenCalledWith({
        src: 'Images/cover.jpg',
        alt: 'Cover',
        blobUrl: 'blob:cover',
        screenBounds: { x: 110, y: 210, width: 20, height: 20 },
      });
    },
  );

  it('keeps the latest click and revokes a stale asynchronous URL', async () => {
    const requests: Deferred<string | undefined>[] = [];
    const fixture = createFixture(
      'native',
      vi.fn(() => {
        const request = deferred<string | undefined>();
        requests.push(request);
        return request.promise;
      }),
    );
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { revokeObjectURL });

    dispatchClick(clickPoint, fixture.deps);
    dispatchClick(clickPoint, fixture.deps);
    requests[1]?.resolve('blob:latest');
    await settleTasks();
    requests[0]?.resolve('blob:stale');
    await settleTasks();

    expect(fixture.imageClick).toHaveBeenCalledOnce();
    expect(fixture.imageClick.mock.calls[0]?.[0].blobUrl).toBe('blob:latest');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:stale');
    expect(fixture.state.activeImageBlobUrl).toBe('blob:latest');
  });

  it('drops a pending native image after a later canvas link click', async () => {
    const pending = deferred<string | undefined>();
    const fixture = createFixture(
      'native',
      vi.fn(() => pending.promise),
    );
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { revokeObjectURL });

    dispatchClick(clickPoint, fixture.deps);
    fixture.state.nativeTargetsByPage.set(0, [
      {
        kind: 'link',
        label: 'Website',
        href: 'https://example.com',
        bounds,
      },
    ]);
    dispatchClick(clickPoint, fixture.deps);
    pending.resolve('blob:stale-link');
    await settleTasks();

    expect(fixture.linkClick).toHaveBeenCalledOnce();
    expect(fixture.imageClick).not.toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:stale-link');
  });

  it('drops a pending legacy image after a later canvas footnote click', async () => {
    const pending = deferred<string | undefined>();
    const fixture = createFixture(
      'legacy',
      vi.fn(() => pending.promise),
    );
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { revokeObjectURL });
    fixture.footnotes.set('Text/chapter.xhtml#note', {
      kind: 'footnote',
      text: 'Note',
      html: '<p>Note</p>',
    });

    dispatchClick(clickPoint, fixture.deps);
    fixture.state.linksByPage.set(0, [{ href: 'Text/chapter.xhtml#note', text: 'note', bounds }]);
    dispatchClick(clickPoint, fixture.deps);
    pending.resolve('blob:stale-footnote');
    await settleTasks();

    expect(fixture.footnoteClick).toHaveBeenCalledOnce();
    expect(fixture.imageClick).not.toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:stale-footnote');
  });

  it('does not revoke an already displayed URL when another content target is clicked', () => {
    const fixture = createFixture(
      'native',
      vi.fn(() => 'blob:displayed'),
    );
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { revokeObjectURL });

    dispatchClick(clickPoint, fixture.deps);
    fixture.state.nativeTargetsByPage.set(0, [
      {
        kind: 'link',
        label: 'Website',
        href: 'https://example.com',
        bounds,
      },
    ]);
    dispatchClick(clickPoint, fixture.deps);

    expect(fixture.state.activeImageBlobUrl).toBe('blob:displayed');
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('revokes both active and late URLs across controller disposal', async () => {
    const pending = deferred<string | undefined>();
    const fixture = createFixture(
      'legacy',
      vi.fn(() => pending.promise),
    );
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { revokeObjectURL });

    fixture.state.activeImageBlobUrl = 'blob:previous';
    dispatchClick(clickPoint, fixture.deps);
    releaseImageClickResources(fixture.deps);
    fixture.state.nativeInteractionsAlive = false;
    pending.resolve('blob:late');
    await settleTasks();

    expect(fixture.imageClick).not.toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:previous');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:late');
    expect(fixture.state.activeImageBlobUrl).toBeNull();
  });

  it('does not emit an image click when the resource is unavailable', async () => {
    const fixture = createFixture(
      'native',
      vi.fn(() => Promise.resolve(undefined)),
    );

    dispatchClick(clickPoint, fixture.deps);
    await settleTasks();

    expect(fixture.imageClick).not.toHaveBeenCalled();
  });

  it.each([
    ['synchronous', (): string => 'blob:cover'],
    ['asynchronous', (): Promise<string> => Promise.resolve('blob:cover')],
  ] as const)(
    'contains a throwing image listener on the %s resource path',
    async (_label, load) => {
      const fixture = createFixture('native', vi.fn(load));
      const errors = vi.fn<(event: ReaderControllerEvents['error']) => void>();
      fixture.deps.emitter.on('imageClick', () => {
        throw new Error('consumer image listener failure');
      });
      fixture.deps.emitter.on('error', errors);

      expect(() => {
        dispatchClick(clickPoint, fixture.deps);
      }).not.toThrow();
      await settleTasks();

      expect(fixture.imageClick).toHaveBeenCalledOnce();
      expect(fixture.state.activeImageBlobUrl).toBe('blob:cover');
      expect(errors).toHaveBeenCalledWith({
        message: 'consumer image listener failure',
        source: 'image-click-publication',
      });
    },
  );
});

const clickPoint = { x: 15, y: 15 };
const bounds = { x: 10, y: 10, width: 20, height: 20 };

function createFixture(mode: 'native' | 'legacy', getImageBlobUrl: Reader['getImageBlobUrl']) {
  const emitter = createEmitter<ReaderControllerEvents>();
  const imageClick = vi.fn<(event: ReaderControllerEvents['imageClick']) => void>();
  const linkClick = vi.fn<(event: ReaderControllerEvents['linkClick']) => void>();
  const footnoteClick = vi.fn<(event: ReaderControllerEvents['footnoteClick']) => void>();
  emitter.on('imageClick', imageClick);
  emitter.on('linkClick', linkClick);
  emitter.on('footnoteClick', footnoteClick);
  const state = createCoordinatorState();
  state.mapper = {
    spreadContentToPage: () => ({ pageIndex: 0, x: 15, y: 15 }),
    pageContentToScreen: () => ({ x: 110, y: 210, width: 20, height: 20 }),
  } as never;
  const target: ReaderInteractionTarget = {
    kind: 'image',
    label: 'Cover',
    imageSrc: 'Images/cover.jpg',
    imageAlt: 'Cover',
    bounds,
  };
  if (mode === 'native') state.nativeTargetsByPage.set(0, [target]);
  else {
    state.hitMaps.set(0, {
      pageIndex: 0,
      entries: [
        {
          bounds,
          blockIndex: 0,
          lineIndex: 0,
          runIndex: 0,
          text: '',
          imageSrc: 'Images/cover.jpg',
          imageAlt: 'Cover',
        },
      ],
    });
  }
  const footnotes = new Map<string, ReaderControllerEvents['footnoteClick']['content']>();
  const reader = {
    ...(mode === 'native' ? { interactions: nativeInteractions() } : {}),
    chapterMap: new Map(),
    manifestHrefMap: new Map(),
    getImageBlobUrl,
    getFootnotes: () => footnotes,
  } as unknown as Reader;
  const deps = {
    reader,
    coordState: state,
    emitter,
    canvas: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
  } as unknown as WiringDeps;
  return { deps, footnoteClick, footnotes, imageClick, linkClick, state };
}

function nativeInteractions(): ReaderInteractions {
  return {
    enabled: true,
    getPageTargets: vi.fn(),
    getFootnote: vi.fn(() => Promise.resolve(undefined)),
    resolveLocator: vi.fn(),
  };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve = (_value: T): void => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function settleTasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
