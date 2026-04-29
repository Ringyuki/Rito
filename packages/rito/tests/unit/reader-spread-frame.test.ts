import { describe, expect, it } from 'vitest';
import type { LayoutBlock, LineBox, Page, Spread, TextRun } from '../../src/layout/core/types';
import { createLayoutConfig } from '../../src/layout/core/config';
import { DEFAULT_RUN_PAINT } from '../../src/layout/text/run-paint-from-style';
import { buildReaderSpreadFrame } from '../../src/runtime/reader-session/frame';
import type { ReaderFrameLocatorInput } from '../../src/runtime/reader-session/frame';
import type { ReaderLocator, ReaderResourceRef } from '../../src/runtime/reader-session/types';

function makeRun(input: {
  readonly text: string;
  readonly x?: number;
  readonly width?: number;
  readonly href?: string;
  readonly sourcePath?: readonly number[];
  readonly sourceTextOffset?: number;
}): TextRun {
  const run: TextRun = {
    type: 'text-run',
    text: input.text,
    bounds: { x: input.x ?? 13, y: 17, width: input.width ?? 80, height: 20 },
    paint: DEFAULT_RUN_PAINT,
    ...(input.sourcePath ? { sourceRef: { nodePath: input.sourcePath } } : {}),
    ...(input.sourceTextOffset !== undefined ? { sourceTextOffset: input.sourceTextOffset } : {}),
  };
  return input.href ? { ...run, href: input.href } : run;
}

function line(runs: readonly TextRun[]): LineBox {
  return {
    type: 'line-box',
    bounds: { x: 7, y: 11, width: 200, height: 24 },
    runs,
  };
}

function block(children: LayoutBlock['children'], x = 3, y = 5): LayoutBlock {
  return {
    type: 'layout-block',
    bounds: { x, y, width: 240, height: 120 },
    children,
  };
}

function page(index: number, content: readonly LayoutBlock[], width = 400, height = 300): Page {
  return {
    index,
    bounds: { x: 0, y: 0, width, height },
    content,
  };
}

function customResourceRef(href: string): ReaderResourceRef {
  return {
    id: `custom:${href}`,
    kind: 'image',
    href,
    mediaType: 'image/test',
  };
}

function customLocator(input: ReaderFrameLocatorInput): ReaderLocator {
  const pageIndex = input.pageIndex !== undefined ? String(input.pageIndex) : 'none';
  return {
    href: `locator:${input.kind}:${pageIndex}`,
    mediaType: input.imageSrc ? 'image/test' : 'application/xhtml+xml',
    progression: 0,
    ...(input.sourceTextOffset !== undefined
      ? {
          sourceRange: {
            start: input.sourceTextOffset,
            end: input.sourceTextOffset + (input.text?.length ?? 0),
          },
        }
      : {}),
  };
}

describe('buildReaderSpreadFrame', () => {
  it('builds a viewport-sized display list and single-spread page indexes', () => {
    const layout = createLayoutConfig({
      width: 400,
      height: 300,
      margin: { top: 20, right: 30, bottom: 40, left: 10 },
    });
    const spread: Spread = {
      index: 0,
      left: page(3, [block([line([makeRun({ text: 'Hello' })])])]),
    };

    const frame = buildReaderSpreadFrame({
      sessionId: 'session-1',
      revisionId: 'rev-1',
      spread,
      layout,
    });

    expect(frame.viewport).toEqual({ width: 400, height: 300 });
    expect(frame.displayList.width).toBe(400);
    expect(frame.displayList.height).toBe(300);
    expect(frame.pageIndexes).toEqual([3]);
  });

  it('keeps double-spread page indexes in visual order', () => {
    const layout = createLayoutConfig({
      width: 820,
      height: 400,
      margin: 10,
      spread: 'double',
      firstPageAlone: false,
      spreadGap: 20,
    });
    const spread: Spread = {
      index: 1,
      left: page(4, [], layout.pageWidth, layout.pageHeight),
      right: page(5, [], layout.pageWidth, layout.pageHeight),
    };

    const frame = buildReaderSpreadFrame({
      sessionId: 'session-1',
      revisionId: 'rev-1',
      spread,
      layout,
    });

    expect(frame.pageIndexes).toEqual([4, 5]);
  });

  it('converts text target bounds from page-content space to spread space', () => {
    const layout = createLayoutConfig({
      width: 400,
      height: 300,
      margin: { top: 20, right: 30, bottom: 40, left: 10 },
    });
    const spread: Spread = {
      index: 0,
      left: page(0, [block([line([makeRun({ text: 'Hello', sourcePath: [0, 1] })])])]),
    };

    const frame = buildReaderSpreadFrame({
      sessionId: 'session-1',
      revisionId: 'rev-1',
      spread,
      layout,
    });

    expect(frame.textRuns[0]?.rect).toEqual({ x: 33, y: 53, width: 80, height: 20 });
    expect(frame.targets[0]?.rect).toEqual({ x: 33, y: 53, width: 80, height: 20 });
  });

  it('converts right-page target bounds with page offset in double spread mode', () => {
    const layout = createLayoutConfig({
      width: 820,
      height: 400,
      margin: { top: 20, right: 10, bottom: 20, left: 10 },
      spread: 'double',
      firstPageAlone: false,
      spreadGap: 20,
    });
    const spread: Spread = {
      index: 0,
      left: page(0, [], layout.pageWidth, layout.pageHeight),
      right: page(
        1,
        [block([line([makeRun({ text: 'Right' })])])],
        layout.pageWidth,
        layout.pageHeight,
      ),
    };

    const frame = buildReaderSpreadFrame({
      sessionId: 'session-1',
      revisionId: 'rev-1',
      spread,
      layout,
    });

    expect(frame.textRuns[0]?.rect).toEqual({ x: 453, y: 53, width: 80, height: 20 });
  });

  it('builds link targets from hit-map entries with injected locators', () => {
    const layout = createLayoutConfig({ width: 400, height: 300, margin: 10 });
    const spread: Spread = {
      index: 0,
      left: page(2, [block([line([makeRun({ text: 'Link', href: 'chapter-2.xhtml' })])])]),
    };

    const frame = buildReaderSpreadFrame({
      sessionId: 'session-1',
      revisionId: 'rev-1',
      spread,
      layout,
      createLocator: customLocator,
    });

    expect(frame.targets[0]).toMatchObject({
      kind: 'link',
      href: 'chapter-2.xhtml',
      label: 'Link',
      locator: { href: 'locator:link:2' },
    });
  });

  it('marks link hit-map entries as footnotes when an injected ref resolves', () => {
    const layout = createLayoutConfig({ width: 400, height: 300, margin: 10 });
    const spread: Spread = {
      index: 0,
      left: page(2, [block([line([makeRun({ text: '1', href: '#fn1' })])])]),
    };

    const frame = buildReaderSpreadFrame({
      sessionId: 'session-1',
      revisionId: 'rev-1',
      spread,
      layout,
      createLocator: customLocator,
      resolveFootnoteRef(input) {
        expect(input).toEqual({ href: '#fn1', pageIndex: 2 });
        return { href: 'chapter-1.xhtml#fn1' };
      },
    });

    expect(frame.targets[0]).toMatchObject({
      kind: 'footnote',
      href: '#fn1',
      footnoteRef: { href: 'chapter-1.xhtml#fn1' },
      locator: { href: 'locator:footnote:2' },
    });
  });

  it('builds image targets and resource refs from hit-map/image-source data', () => {
    const layout = createLayoutConfig({ width: 400, height: 300, margin: 10 });
    const imageBlock = block([
      {
        type: 'image',
        src: 'Images/cover.jpg',
        alt: 'Cover',
        bounds: { x: 8, y: 9, width: 70, height: 90 },
      },
    ]);
    const spread: Spread = {
      index: 0,
      left: page(7, [imageBlock]),
    };

    const frame = buildReaderSpreadFrame({
      sessionId: 'session-1',
      revisionId: 'rev-1',
      spread,
      layout,
      createResourceRef: customResourceRef,
      createLocator: customLocator,
    });

    expect(frame.resourceRefs).toEqual([
      {
        id: 'custom:Images/cover.jpg',
        kind: 'image',
        href: 'Images/cover.jpg',
        mediaType: 'image/test',
      },
    ]);
    const resourceRef = frame.resourceRefs[0];
    expect(resourceRef).toBeDefined();
    if (!resourceRef) throw new Error('Expected resource ref');
    expect('bytes' in resourceRef).toBe(false);
    expect(frame.targets[0]).toMatchObject({
      kind: 'image',
      label: 'Cover',
      rect: { x: 21, y: 24, width: 70, height: 90 },
      resourceRef: { id: 'custom:Images/cover.jpg' },
      locator: { href: 'locator:image:7' },
    });
  });

  it('passes first source-backed text to injected primary locator creation', () => {
    const layout = createLayoutConfig({ width: 400, height: 300, margin: 10 });
    const spread: Spread = {
      index: 0,
      left: page(1, [
        block([
          line([
            makeRun({
              text: 'Source',
              sourcePath: [2, 4, 1],
              sourceTextOffset: 12,
            }),
          ]),
        ]),
      ]),
    };

    const frame = buildReaderSpreadFrame({
      sessionId: 'session-1',
      revisionId: 'rev-1',
      spread,
      layout,
      createLocator(input) {
        return {
          href: `chapter.xhtml#${input.sourcePath?.join('/') ?? 'fallback'}`,
          mediaType: 'application/xhtml+xml',
          progression: 0,
          ...(input.sourceTextOffset !== undefined && input.text
            ? {
                sourceRange: {
                  start: input.sourceTextOffset,
                  end: input.sourceTextOffset + input.text.length,
                },
              }
            : {}),
          ...(input.text ? { text: { highlight: input.text } } : {}),
        };
      },
    });

    expect(frame.primaryLocator).toMatchObject({
      href: 'chapter.xhtml#2/4/1',
      mediaType: 'application/xhtml+xml',
      sourceRange: { start: 12, end: 18 },
      text: { highlight: 'Source' },
    });
  });

  it('does not invent source hrefs in the default locator fallback', () => {
    const layout = createLayoutConfig({ width: 400, height: 300, margin: 10 });
    const spread: Spread = {
      index: 0,
      left: page(1, [
        block([
          line([
            makeRun({
              text: 'Source',
              sourcePath: [2, 4, 1],
              sourceTextOffset: 12,
            }),
          ]),
        ]),
      ]),
    };

    const frame = buildReaderSpreadFrame({
      sessionId: 'session-1',
      revisionId: 'rev-1',
      spread,
      layout,
    });

    expect(frame.primaryLocator).toMatchObject({
      href: 'page:1',
      mediaType: 'application/xhtml+xml',
      position: 1,
    });
    expect(frame.primaryLocator.href.startsWith('source:')).toBe(false);
    expect(frame.primaryLocator.text).toBeUndefined();
    expect(frame.primaryLocator.anchorId).toBeUndefined();
    expect(frame.primaryLocator.sourceRange).toBeUndefined();
  });

  it('falls back to a page locator for image-only spreads without source-backed text', () => {
    const layout = createLayoutConfig({ width: 400, height: 300, margin: 10 });
    const spread: Spread = {
      index: 0,
      left: page(7, [
        block([
          {
            type: 'image',
            src: 'Images/cover.png',
            bounds: { x: 0, y: 0, width: 100, height: 120 },
          },
        ]),
      ]),
    };

    const frame = buildReaderSpreadFrame({
      sessionId: 'session-1',
      revisionId: 'rev-1',
      spread,
      layout,
    });

    expect(frame.textRuns).toEqual([]);
    expect(frame.primaryLocator).toMatchObject({
      href: 'page:7',
      mediaType: 'application/xhtml+xml',
      position: 7,
    });
  });
});
