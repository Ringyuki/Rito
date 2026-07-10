import { describe, expect, it } from 'vitest';
import type { LayoutBlock, Page } from '../../src/layout/core/types';
import { createLayoutConfig } from '../../src/layout/core/config';
import { DEFAULT_RUN_PAINT } from '../../src/layout/text/run-paint-from-style';
import { buildPageDisplayList } from '../../src/render/display-list';

const CONFIG = createLayoutConfig({ width: 400, height: 600, margin: 20 });

function makePage(content: readonly LayoutBlock[], paint?: Page['paint']): Page {
  return {
    index: 0,
    bounds: { x: 0, y: 0, width: CONFIG.pageWidth, height: CONFIG.pageHeight },
    content,
    ...(paint ? { paint } : {}),
  };
}

function textBlock(text: string): LayoutBlock {
  return {
    type: 'layout-block',
    bounds: { x: 3, y: 5, width: 120, height: 24 },
    children: [
      {
        type: 'line-box',
        bounds: { x: 7, y: 11, width: 90, height: 24 },
        runs: [
          {
            type: 'text-run',
            text,
            bounds: { x: 13, y: 17, width: 80, height: 20 },
            paint: DEFAULT_RUN_PAINT,
          },
        ],
      },
    ],
  };
}

describe('display list', () => {
  it('builds page paint, page clip, and absolute text commands', () => {
    const displayList = buildPageDisplayList(
      makePage([textBlock('Hello')], { backgroundColor: '#f8f8f8' }),
      CONFIG,
    );

    expect(displayList.width).toBe(400);
    expect(displayList.height).toBe(600);
    expect(displayList.commands.slice(0, 3)).toEqual([
      {
        kind: 'paintPage',
        rect: { x: 0, y: 0, width: 400, height: 600 },
        paint: { backgroundColor: '#f8f8f8' },
      },
      { kind: 'pushState' },
      { kind: 'clipRect', rect: { x: 0, y: 0, width: 400, height: 600 } },
    ]);

    const text = displayList.commands.find((command) => command.kind === 'paintText');
    expect(text).toEqual({
      kind: 'paintText',
      text: 'Hello',
      rect: { x: 43, y: 53, width: 80, height: 20 },
      paint: DEFAULT_RUN_PAINT,
    });
  });

  it('keeps effect commands platform-neutral', () => {
    const block: LayoutBlock = {
      type: 'layout-block',
      bounds: { x: 0, y: 0, width: 100, height: 50 },
      children: [],
      paint: {
        opacity: 0.5,
        visualOffset: { dx: 4, dy: 8 },
        clipToBounds: true,
        radius: { px: 6 },
        background: { color: '#fff' },
      },
    };

    const commands = buildPageDisplayList(makePage([block]), CONFIG).commands;
    expect(commands.map((command) => command.kind)).toEqual([
      'pushState',
      'clipRect',
      'pushState',
      'translate',
      'pushState',
      'opacity',
      'paintBlock',
      'pushState',
      'clipRect',
      'popState',
      'popState',
      'popState',
      'popState',
    ]);
    expect(commands).toContainEqual({ kind: 'translate', dx: 4, dy: 8 });
    expect(commands).toContainEqual({ kind: 'opacity', value: 0.5 });
    expect(commands).toContainEqual({
      kind: 'clipRect',
      rect: { x: 20, y: 20, width: 100, height: 50 },
      radius: { rx: 6, ry: 6 },
    });
    const paintBlock = commands.find((command) => command.kind === 'paintBlock');
    expect(paintBlock).toEqual({
      kind: 'paintBlock',
      rect: { x: 20, y: 20, width: 100, height: 50 },
      paint: {
        background: { color: '#fff' },
        radius: { px: 6 },
      },
    });
  });

  it('emits image and horizontal rule commands', () => {
    const block: LayoutBlock = {
      type: 'layout-block',
      bounds: { x: 0, y: 0, width: 200, height: 80 },
      children: [
        {
          type: 'image',
          src: 'Images/cover.jpg',
          alt: 'Cover',
          href: 'chapter.xhtml',
          bounds: { x: 5, y: 7, width: 40, height: 60 },
        },
        {
          type: 'hr',
          bounds: { x: 0, y: 70, width: 200, height: 2 },
          paint: { color: '#333', style: 'dashed' },
        },
      ],
    };

    const commands = buildPageDisplayList(makePage([block]), CONFIG).commands;
    expect(commands).toContainEqual({
      kind: 'paintImage',
      src: 'Images/cover.jpg',
      alt: 'Cover',
      href: 'chapter.xhtml',
      rect: { x: 25, y: 27, width: 40, height: 60 },
    });
    expect(commands).toContainEqual({
      kind: 'paintHorizontalRule',
      rect: { x: 20, y: 90, width: 200, height: 2 },
      paint: { color: '#333', style: 'dashed' },
    });
  });

  it('keeps decorations and shadows in sync with a contrast foreground override', () => {
    const block = textBlock('Themed');
    const line = block.children[0];
    if (line?.type !== 'line-box') throw new Error('Expected line box');
    const run = line.runs[0];
    if (run?.type !== 'text-run') throw new Error('Expected text run');
    const themedBlock: LayoutBlock = {
      ...block,
      children: [
        {
          ...line,
          runs: [
            {
              ...run,
              paint: {
                ...run.paint,
                color: '#111111',
                decoration: {
                  kind: 'underline',
                  y: 16,
                  thickness: 1,
                  color: '#111111',
                },
                textShadow: [{ offsetX: 1, offsetY: 1, blur: 2, color: '#222222' }],
              },
            },
          ],
        },
      ],
    };

    const command = buildPageDisplayList(makePage([themedBlock]), CONFIG, {
      backgroundColor: '#000000',
      foregroundColor: '#eeeeee',
    }).commands.find((candidate) => candidate.kind === 'paintText');

    expect(command?.kind).toBe('paintText');
    if (command?.kind !== 'paintText') return;
    expect(command.paint.color).toBe('#eeeeee');
    expect(command.paint.decoration?.color).toBe('#eeeeee');
    expect(command.paint.textShadow?.[0]?.color).toBe('#eeeeee');
  });
});
