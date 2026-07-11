import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  Reader,
  ReaderInteractionTarget,
  ReaderInteractions,
  ReaderLocator,
} from '@ritojs/core';
import { createCoordinatorState } from '../src/controller/core';
import type { WiringDeps } from '../src/controller/core';
import type { ReaderControllerEvents } from '../src/controller/types';
import { dispatchClick } from '../src/controller/wiring/click-dispatch';
import { createEmitter } from '../src/utils/event-emitter';

const locator: ReaderLocator = { href: 'Text/chapter.xhtml', anchorId: 'target' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('native click dispatch', () => {
  it('uses the exact Rust footnote key without legacy href guessing', async () => {
    const getFootnote = vi.fn(() =>
      Promise.resolve({
        kind: 'footnote' as const,
        text: 'Exact note',
        html: '<p>Exact note</p>',
      }),
    );
    const fixture = createFixture(interactions({ getFootnote }));
    fixture.install(
      target('footnote', { href: '#shared', footnoteKey: 'Text/notes.xhtml#shared' }),
    );
    let event: ReaderControllerEvents['footnoteClick'] | undefined;
    fixture.emitter.on('footnoteClick', (value) => {
      event = value;
    });

    dispatchClick({ x: 15, y: 15 }, fixture.deps);
    await Promise.resolve();

    expect(getFootnote).toHaveBeenCalledWith('Text/notes.xhtml#shared');
    expect(fixture.reader.getFootnotes).not.toHaveBeenCalled();
    expect(event?.content.text).toBe('Exact note');
  });

  it('drops a footnote result after the visible target generation changes', async () => {
    const pending = deferred<{
      readonly kind: 'footnote';
      readonly text: string;
      readonly html: string;
    }>();
    const fixture = createFixture(interactions({ getFootnote: vi.fn(() => pending.promise) }));
    fixture.install(target('footnote', { href: '#note', footnoteKey: 'Text/note.xhtml#note' }));
    const footnoteClick = vi.fn();
    fixture.emitter.on('footnoteClick', footnoteClick);

    dispatchClick({ x: 15, y: 15 }, fixture.deps);
    fixture.state.nativeTargetLoadGeneration += 1;
    pending.resolve({ kind: 'footnote', text: 'stale', html: '<p>stale</p>' });
    await Promise.resolve();

    expect(footnoteClick).not.toHaveBeenCalled();
  });

  it('re-resolves an internal locator against the capability active when navigate is invoked', async () => {
    const originalResolve = vi.fn();
    const currentResolve = vi.fn(() =>
      Promise.resolve({
        status: 'resolved' as const,
        locator,
        spineIdref: 'chapter',
        pageIndex: 12,
        spreadIndex: 6,
        matchedBy: 'anchor' as const,
      }),
    );
    const fixture = createFixture(interactions({ resolveLocator: originalResolve }));
    fixture.install(target('link', { href: '#target', targetLocator: locator }));
    let event: ReaderControllerEvents['linkClick'] | undefined;
    fixture.emitter.on('linkClick', (value) => {
      event = value;
    });

    dispatchClick({ x: 15, y: 15 }, fixture.deps);
    fixture.reader.interactions = interactions({ resolveLocator: currentResolve });
    event?.navigate();
    await Promise.resolve();

    expect(originalResolve).not.toHaveBeenCalled();
    expect(currentResolve).toHaveBeenCalledWith(locator);
    expect(fixture.goToSpread).toHaveBeenCalledWith(6);
  });

  it('does not navigate when exact resolution becomes stale or pending', async () => {
    const resolveLocator = vi.fn(() => Promise.resolve(undefined));
    const fixture = createFixture(interactions({ resolveLocator }));
    fixture.install(target('link', { href: '#target', targetLocator: locator }));
    let navigate: (() => void) | undefined;
    fixture.emitter.on('linkClick', (event) => {
      navigate = event.navigate;
    });

    dispatchClick({ x: 15, y: 15 }, fixture.deps);
    navigate?.();
    await Promise.resolve();

    expect(fixture.goToSpread).not.toHaveBeenCalled();
  });

  it('drops an in-flight internal resolution after navigation or disposal invalidates targets', async () => {
    const pending = deferred<{
      readonly status: 'resolved';
      readonly locator: ReaderLocator;
      readonly spineIdref: string;
      readonly pageIndex: number;
      readonly spreadIndex: number;
      readonly matchedBy: 'anchor';
    }>();
    const fixture = createFixture(interactions({ resolveLocator: vi.fn(() => pending.promise) }));
    fixture.install(target('link', { href: '#target', targetLocator: locator }));
    let navigate: (() => void) | undefined;
    fixture.emitter.on('linkClick', (event) => {
      navigate = event.navigate;
    });

    dispatchClick({ x: 15, y: 15 }, fixture.deps);
    navigate?.();
    fixture.state.nativeTargetLoadGeneration += 1;
    pending.resolve({
      status: 'resolved',
      locator,
      spineIdref: 'chapter',
      pageIndex: 12,
      spreadIndex: 6,
      matchedBy: 'anchor',
    });
    await Promise.resolve();

    expect(fixture.goToSpread).not.toHaveBeenCalled();
  });

  it('does not let a retained navigate callback re-enter a disposed controller', () => {
    const resolveLocator = vi.fn();
    const fixture = createFixture(interactions({ resolveLocator }));
    fixture.install(target('link', { href: '#target', targetLocator: locator }));
    let navigate: (() => void) | undefined;
    fixture.emitter.on('linkClick', (event) => {
      navigate = event.navigate;
    });

    dispatchClick({ x: 15, y: 15 }, fixture.deps);
    fixture.state.nativeInteractionsAlive = false;
    fixture.state.nativeTargetLoadGeneration += 1;
    navigate?.();

    expect(resolveLocator).not.toHaveBeenCalled();
    expect(fixture.goToSpread).not.toHaveBeenCalled();
  });

  it.each(['mailto:reader@example.com', '//example.com/chapter'])(
    'keeps core-classified external hrefs actionable: %s',
    (href) => {
      const open = vi.fn();
      vi.stubGlobal('window', { open });
      const fixture = createFixture(interactions());
      fixture.install(target('link', { href }));
      let event: ReaderControllerEvents['linkClick'] | undefined;
      fixture.emitter.on('linkClick', (value) => {
        event = value;
      });

      dispatchClick({ x: 15, y: 15 }, fixture.deps);
      event?.navigate();

      expect(event?.type).toBe('external');
      expect(open).toHaveBeenCalledWith(href, '_blank', 'noopener');
    },
  );

  it('does not execute an unsafe external URI scheme', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    const fixture = createFixture(interactions());
    fixture.install(target('link', { href: 'javascript:alert(1)' }));
    let event: ReaderControllerEvents['linkClick'] | undefined;
    fixture.emitter.on('linkClick', (value) => {
      event = value;
    });

    dispatchClick({ x: 15, y: 15 }, fixture.deps);
    event?.navigate();

    expect(event?.type).toBe('external');
    expect(open).not.toHaveBeenCalled();
  });

  it('dispatches standalone native images with core-owned bounds', () => {
    const fixture = createFixture(interactions());
    fixture.install(target('image', { imageSrc: 'Images/cover.jpg', imageAlt: 'Cover' }));
    let event: ReaderControllerEvents['imageClick'] | undefined;
    fixture.emitter.on('imageClick', (value) => {
      event = value;
    });

    dispatchClick({ x: 15, y: 15 }, fixture.deps);

    expect(fixture.reader.getImageBlobUrl).toHaveBeenCalledWith('Images/cover.jpg');
    expect(event).toMatchObject({
      src: 'Images/cover.jpg',
      alt: 'Cover',
      blobUrl: 'blob:cover',
      screenBounds: { x: 110, y: 210, width: 20, height: 20 },
    });
  });

  it('never falls back to legacy link geometry when native targets are unavailable', () => {
    const fixture = createFixture(interactions({ enabled: false }));
    fixture.state.linksByPage.set(0, [
      { href: 'https://legacy.invalid', text: 'legacy', bounds: targetBounds() },
    ]);
    const linkClick = vi.fn();
    const annotationClick = vi.fn();
    fixture.emitter.on('linkClick', linkClick);
    fixture.emitter.on('annotationClick', annotationClick);
    fixture.state.resolvedAnnotations = [
      {
        status: 'resolved',
        segments: [{ pageIndex: 0, rects: [targetBounds()] }],
      },
    ] as never;

    dispatchClick({ x: 15, y: 15 }, fixture.deps);

    expect(linkClick).not.toHaveBeenCalled();
    expect(annotationClick).not.toHaveBeenCalled();
  });
});

function createFixture(initialInteractions: ReaderInteractions) {
  const emitter = createEmitter<ReaderControllerEvents>();
  const state = createCoordinatorState();
  state.mapper = {
    spreadContentToPage: () => ({ pageIndex: 0, x: 15, y: 15 }),
    pageContentToScreen: (_pageIndex: number, bounds: ReaderInteractionTarget['bounds']) => ({
      x: bounds.x + 100,
      y: bounds.y + 200,
      width: bounds.width,
      height: bounds.height,
    }),
  } as never;
  const reader = {
    interactions: initialInteractions,
    getFootnotes: vi.fn(() => new Map()),
    getImageBlobUrl: vi.fn(() => 'blob:cover'),
  };
  const goToSpread = vi.fn();
  const deps = {
    reader: reader as unknown as Reader,
    coordState: state,
    emitter,
    goToSpread,
    canvas: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
  } as unknown as WiringDeps;
  return {
    deps,
    emitter,
    goToSpread,
    reader,
    state,
    install(value: ReaderInteractionTarget) {
      state.nativeTargetsByPage.set(0, [value]);
    },
  };
}

function interactions(
  overrides: {
    readonly enabled?: boolean;
    readonly getFootnote?: ReaderInteractions['getFootnote'];
    readonly resolveLocator?: ReaderInteractions['resolveLocator'];
  } = {},
): ReaderInteractions {
  return {
    enabled: overrides.enabled ?? true,
    getPageTargets: vi.fn(),
    getFootnote: overrides.getFootnote ?? vi.fn(),
    resolveLocator: overrides.resolveLocator ?? vi.fn(),
  };
}

function target(
  kind: ReaderInteractionTarget['kind'],
  fields: Omit<Partial<ReaderInteractionTarget>, 'kind' | 'bounds' | 'label'> = {},
): ReaderInteractionTarget {
  return { kind, bounds: targetBounds(), label: kind, ...fields };
}

function targetBounds() {
  return { x: 10, y: 10, width: 20, height: 20 };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
