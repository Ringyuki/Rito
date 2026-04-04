import { describe, expect, it } from 'vitest';
import { layoutImageBlock } from '../../src/layout/block/image';
import { DEFAULT_STYLE } from '../../src/style/defaults';
import type { ImageSizeMap } from '../../src/layout/block';
import type { ImageElement, LayoutBlock } from '../../src/layout/core/types';

function getImage(block: LayoutBlock): ImageElement {
  const child = block.children[0];
  if (!child || child.type !== 'image') throw new Error('Expected ImageElement child');
  return child;
}

function makeSizeMap(map: Record<string, { width: number; height: number }>): ImageSizeMap {
  return {
    getSize(src: string) {
      return map[src];
    },
  };
}

describe('layoutImageBlock', () => {
  const contentWidth = 400;
  const contentHeight = 600;

  it('uses fallback dimensions when no size map is provided', () => {
    const block = layoutImageBlock(
      'img.png',
      contentWidth,
      contentHeight,
      0,
      undefined,
      DEFAULT_STYLE,
    );
    expect(block.type).toBe('layout-block');
    // Fallback aspect ratio is 0.75, so height = 400 * 0.75 = 300
    expect(block.bounds.width).toBe(contentWidth);
    expect(block.bounds.height).toBe(300);
  });

  it('scales to fit content width while preserving aspect ratio', () => {
    const sizes = makeSizeMap({ 'photo.jpg': { width: 800, height: 400 } });
    const block = layoutImageBlock(
      'photo.jpg',
      contentWidth,
      contentHeight,
      0,
      sizes,
      DEFAULT_STYLE,
    );
    const img = getImage(block);
    expect(img.type).toBe('image');
    // aspect = 400/800 = 0.5, width = contentWidth, height = 400 * 0.5 = 200
    expect(img.bounds.width).toBe(400);
    expect(img.bounds.height).toBe(200);
  });

  it('scales down an image wider than content width', () => {
    const sizes = makeSizeMap({ 'wide.png': { width: 1200, height: 600 } });
    const block = layoutImageBlock(
      'wide.png',
      contentWidth,
      contentHeight,
      0,
      sizes,
      DEFAULT_STYLE,
    );
    const img = getImage(block);
    // aspect = 0.5, width capped to 400, height = 200
    expect(img.bounds.width).toBe(400);
    expect(img.bounds.height).toBe(200);
  });

  it('does not scale up a small image beyond content width', () => {
    // The code uses contentWidth as default width (no style.width), so
    // even a small intrinsic image fills contentWidth.
    const sizes = makeSizeMap({ 'tiny.png': { width: 100, height: 50 } });
    const block = layoutImageBlock(
      'tiny.png',
      contentWidth,
      contentHeight,
      0,
      sizes,
      DEFAULT_STYLE,
    );
    const img = getImage(block);
    // aspect = 0.5, width = contentWidth = 400, height = 200
    expect(img.bounds.width).toBe(400);
    expect(img.bounds.height).toBe(200);
  });

  it('clamps height to content height when image is very tall', () => {
    const sizes = makeSizeMap({ 'tall.png': { width: 400, height: 2000 } });
    const block = layoutImageBlock(
      'tall.png',
      contentWidth,
      contentHeight,
      0,
      sizes,
      DEFAULT_STYLE,
    );
    const img = getImage(block);
    // aspect = 5, height capped to 600, width = 600 / 5 = 120
    expect(img.bounds.height).toBe(contentHeight);
    expect(img.bounds.width).toBe(120);
  });

  it('applies Y offset to block bounds', () => {
    const block = layoutImageBlock(
      'img.png',
      contentWidth,
      contentHeight,
      50,
      undefined,
      DEFAULT_STYLE,
    );
    expect(block.bounds.y).toBe(50);
    // Image element y is relative to block (always 0)
    const img = getImage(block);
    expect(img.bounds.y).toBe(0);
  });

  it('returns a block with an ImageElement child', () => {
    const block = layoutImageBlock(
      'cover.png',
      contentWidth,
      contentHeight,
      0,
      undefined,
      DEFAULT_STYLE,
    );
    expect(block.children).toHaveLength(1);
    const img = getImage(block);
    expect(img.type).toBe('image');
    expect(img.src).toBe('cover.png');
  });

  it('centers image horizontally when narrower than content', () => {
    const sizes = makeSizeMap({ 'tall.png': { width: 200, height: 1000 } });
    // aspect = 5, width = 400, height = 2000 -> clamped to 600, width = 120
    const block = layoutImageBlock(
      'tall.png',
      contentWidth,
      contentHeight,
      0,
      sizes,
      DEFAULT_STYLE,
    );
    const img = getImage(block);
    expect(img.bounds.x).toBe((contentWidth - img.bounds.width) / 2);
  });
});
