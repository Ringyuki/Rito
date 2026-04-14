/**
 * Phase 0 characterization: background paint in background-renderer.
 *
 * Pins down:
 *   - border-radius resolution (px vs percentage)
 *   - backgroundPosition keyword parsing (left/center/right × top/center/bottom)
 *   - backgroundSize (cover / contain / auto)
 *   - backgroundRepeat (repeat vs no-repeat)
 *   - default position selection based on size
 *
 * Phase 1 will replace the string-based position parser with a structured
 * BackgroundPosition type — any expected-value change must update these tests
 * deliberately, not silently.
 */
import { describe, expect, it } from 'vitest';
import {
  renderBlockBackground,
  resolveBlockRadius,
} from '../../src/render/page/background-renderer';
import { parseBackgroundPosition } from '../../src/style/css/parse-background-position';
import type { BackgroundPosition } from '../../src/style/core/paint-types';
import type { BlockPaint, LayoutBlock } from '../../src/layout/core/types';
import { createMockCanvasContext, isCall, type CanvasCall } from '../helpers/mock-canvas-context';

function calls(records: readonly unknown[]): CanvasCall[] {
  return (records as ReadonlyArray<CanvasCall>).filter(isCall);
}

interface BlockOverrides {
  readonly backgroundColor?: string;
  readonly backgroundImage?: string;
  readonly backgroundSize?: 'cover' | 'contain' | 'auto';
  readonly backgroundRepeat?: 'repeat' | 'no-repeat';
  readonly backgroundPosition?: BackgroundPosition;
  readonly borderRadius?: number;
  readonly borderRadiusPct?: number;
}

function makeBlock(overrides: BlockOverrides = {}): LayoutBlock {
  type MutableBlockPaint = {
    -readonly [K in keyof BlockPaint]: BlockPaint[K];
  };
  const paint: MutableBlockPaint = {};
  const bg: {
    color?: string;
    image?: string;
    size?: 'cover' | 'contain' | 'auto';
    repeat?: 'repeat' | 'no-repeat';
    position?: BackgroundPosition;
  } = {};
  if (overrides.backgroundColor !== undefined) bg.color = overrides.backgroundColor;
  if (overrides.backgroundImage !== undefined) bg.image = overrides.backgroundImage;
  if (overrides.backgroundSize !== undefined) bg.size = overrides.backgroundSize;
  if (overrides.backgroundRepeat !== undefined) bg.repeat = overrides.backgroundRepeat;
  if (overrides.backgroundPosition !== undefined) bg.position = overrides.backgroundPosition;
  if (Object.keys(bg).length > 0) paint.background = bg;

  const radius: { px?: number; pct?: number } = {};
  if (overrides.borderRadius !== undefined) radius.px = overrides.borderRadius;
  if (overrides.borderRadiusPct !== undefined) radius.pct = overrides.borderRadiusPct;
  if (Object.keys(radius).length > 0) paint.radius = radius;

  return {
    type: 'layout-block',
    bounds: { x: 0, y: 0, width: 200, height: 100 },
    children: [],
    ...(Object.keys(paint).length > 0 ? { paint } : {}),
  };
}

interface FakeBitmap {
  readonly width: number;
  readonly height: number;
}

function makeBitmap(w: number, h: number): FakeBitmap {
  return { width: w, height: h };
}

function imageMap(href: string, bitmap: FakeBitmap): ReadonlyMap<string, ImageBitmap> {
  return new Map([[href, bitmap as unknown as ImageBitmap]]);
}

describe('Phase 0 — border-radius resolution', () => {
  it('borderRadius=8 returns {rx:8, ry:8}', () => {
    const radius = resolveBlockRadius(makeBlock({ borderRadius: 8 }));
    expect(radius).toEqual({ rx: 8, ry: 8 });
  });

  it('borderRadiusPct=50 on a 200×100 box returns {rx:100, ry:50}', () => {
    const radius = resolveBlockRadius(makeBlock({ borderRadiusPct: 50 }));
    expect(radius).toEqual({ rx: 100, ry: 50 });
  });

  it('borderRadiusPct takes priority over borderRadius when both set', () => {
    const radius = resolveBlockRadius(makeBlock({ borderRadius: 8, borderRadiusPct: 25 }));
    // 25% of 200 = 50; 25% of 100 = 25
    expect(radius).toEqual({ rx: 50, ry: 25 });
  });

  it('neither set returns {rx:0, ry:0}', () => {
    const radius = resolveBlockRadius(makeBlock());
    expect(radius).toEqual({ rx: 0, ry: 0 });
  });
});

describe('Phase 0 — backgroundColor painting', () => {
  it('solid fill uses fillRect when no radius', () => {
    const mock = createMockCanvasContext();
    const block = makeBlock({ backgroundColor: '#ff0000' });
    renderBlockBackground(mock.ctx, block, 10, 20, { rx: 0, ry: 0 });

    const fillRect = calls(mock.records).find((c) => c.method === 'fillRect');
    expect(fillRect?.args).toEqual([10, 20, 200, 100]);
    const fillStyleSet = mock.getPropertySets('fillStyle');
    expect(fillStyleSet[0]?.value).toBe('#ff0000');
  });

  it('rounded fill uses path + fill() when radius > 0', () => {
    const mock = createMockCanvasContext();
    const block = makeBlock({ backgroundColor: '#00ff00' });
    renderBlockBackground(mock.ctx, block, 0, 0, { rx: 5, ry: 5 });

    const fillRectCalls = calls(mock.records).filter((c) => c.method === 'fillRect');
    const fillCalls = calls(mock.records).filter((c) => c.method === 'fill');
    expect(fillRectCalls).toHaveLength(0);
    expect(fillCalls.length).toBeGreaterThan(0);
  });

  it('no backgroundColor emits no fillRect / fill()', () => {
    const mock = createMockCanvasContext();
    renderBlockBackground(mock.ctx, makeBlock(), 0, 0, { rx: 0, ry: 0 });

    const fillRect = calls(mock.records).filter((c) => c.method === 'fillRect');
    const fill = calls(mock.records).filter((c) => c.method === 'fill');
    expect(fillRect).toHaveLength(0);
    expect(fill).toHaveLength(0);
  });
});

describe('Phase 0 — backgroundImage + size + position + repeat', () => {
  const HREF = 'cover.png';
  const images = imageMap(HREF, makeBitmap(100, 100));

  function drawImageCalls(records: readonly unknown[]): CanvasCall[] {
    return calls(records).filter((c) => c.method === 'drawImage');
  }

  describe('size', () => {
    it('size=cover scales to max(w/imgW, h/imgH) keeping aspect', () => {
      const mock = createMockCanvasContext();
      const block = makeBlock({
        backgroundImage: HREF,
        backgroundSize: 'cover',
        backgroundRepeat: 'no-repeat',
      });
      // 200×100 block, 100×100 image → scale = max(200/100, 100/100) = 2
      // drawW = drawH = 200
      renderBlockBackground(mock.ctx, block, 0, 0, { rx: 0, ry: 0 }, images);

      const draws = drawImageCalls(mock.records);
      expect(draws).toHaveLength(1);
      // Centered by default: drawX = (200 - 200)/2 = 0, drawY = (100 - 200)/2 = -50
      expect(draws[0]?.args.slice(1)).toEqual([0, -50, 200, 200]);
    });

    it('size=contain scales to min(w/imgW, h/imgH) keeping aspect', () => {
      const mock = createMockCanvasContext();
      const block = makeBlock({
        backgroundImage: HREF,
        backgroundSize: 'contain',
        backgroundRepeat: 'no-repeat',
      });
      // scale = min(200/100, 100/100) = 1 → drawW = drawH = 100
      renderBlockBackground(mock.ctx, block, 0, 0, { rx: 0, ry: 0 }, images);

      const draws = drawImageCalls(mock.records);
      expect(draws).toHaveLength(1);
      // Centered: drawX = (200-100)/2 = 50, drawY = (100-100)/2 = 0
      expect(draws[0]?.args.slice(1)).toEqual([50, 0, 100, 100]);
    });

    it('size=auto keeps image native dimensions (no scale)', () => {
      const mock = createMockCanvasContext();
      const block = makeBlock({
        backgroundImage: HREF,
        backgroundSize: 'auto',
        backgroundRepeat: 'no-repeat',
      });
      renderBlockBackground(mock.ctx, block, 0, 0, { rx: 0, ry: 0 }, images);

      const draws = drawImageCalls(mock.records);
      expect(draws).toHaveLength(1);
      // auto default position = '0% 0%' → drawX=0, drawY=0, drawW=imgW=100, drawH=imgH=100
      expect(draws[0]?.args.slice(1)).toEqual([0, 0, 100, 100]);
    });
  });

  describe('position (no-repeat)', () => {
    function drawSingle(pos: string, size: 'cover' | 'contain' | 'auto'): unknown[] {
      const mock = createMockCanvasContext();
      const parsed = parseBackgroundPosition(pos);
      const block = makeBlock({
        backgroundImage: HREF,
        backgroundSize: size,
        ...(parsed ? { backgroundPosition: parsed } : {}),
        backgroundRepeat: 'no-repeat',
      });
      renderBlockBackground(mock.ctx, block, 0, 0, { rx: 0, ry: 0 }, images);
      const draws = drawImageCalls(mock.records);
      const first = draws[0];
      if (!first) return [];
      return first.args.slice(1);
    }

    it('"center center" with contain centers the image', () => {
      // 200×100 block, 100×100 image, contain → drawW=drawH=100
      expect(drawSingle('center center', 'contain')).toEqual([50, 0, 100, 100]);
    });

    it('"left top" anchors to block origin (contain)', () => {
      expect(drawSingle('left top', 'contain')).toEqual([0, 0, 100, 100]);
    });

    it('"right bottom" anchors to bottom-right', () => {
      // drawX = 0 + 200 - 100 = 100; drawY = 0 + 100 - 100 = 0
      expect(drawSingle('right bottom', 'contain')).toEqual([100, 0, 100, 100]);
    });

    it('"center top" centers horizontally, anchors top', () => {
      expect(drawSingle('center top', 'contain')).toEqual([50, 0, 100, 100]);
    });

    it('single-token position defaults second axis to center', () => {
      // parseBackgroundPosition('center') → { x:50%, y:50% }
      expect(drawSingle('center', 'contain')).toEqual([50, 0, 100, 100]);
    });

    it('unknown keyword → parser returns undefined → paint uses size default', () => {
      // Phase 1: 'foo bar' is unparseable. Paint falls back to size-dependent
      // default (50% 50% for contain), i.e. centered.
      expect(drawSingle('foo bar', 'contain')).toEqual([50, 0, 100, 100]);
    });

    it('percentage tokens resolve structurally (50% 50% centers)', () => {
      // Phase 1: parser returns { x:50%, y:50% } → centered.
      expect(drawSingle('50% 50%', 'contain')).toEqual([50, 0, 100, 100]);
    });

    it('pixel position offsets from origin (10px 20px)', () => {
      // drawX = 0 + 10, drawY = 0 + 20; image 100×100 not scaled (contain → 100×100)
      expect(drawSingle('10px 20px', 'contain')).toEqual([10, 20, 100, 100]);
    });

    it('omitted backgroundPosition defaults to "0% 0%" for size=auto', () => {
      const mock = createMockCanvasContext();
      const block = makeBlock({
        backgroundImage: HREF,
        backgroundSize: 'auto',
        backgroundRepeat: 'no-repeat',
      });
      renderBlockBackground(mock.ctx, block, 0, 0, { rx: 0, ry: 0 }, images);
      const draws = drawImageCalls(mock.records);
      expect(draws[0]?.args.slice(1)).toEqual([0, 0, 100, 100]);
    });

    it('omitted backgroundPosition defaults to "center center" for size=cover', () => {
      const mock = createMockCanvasContext();
      const block = makeBlock({
        backgroundImage: HREF,
        backgroundSize: 'cover',
        backgroundRepeat: 'no-repeat',
      });
      renderBlockBackground(mock.ctx, block, 0, 0, { rx: 0, ry: 0 }, images);
      const draws = drawImageCalls(mock.records);
      // cover: drawW = drawH = 200 → centered: 0, -50, 200, 200
      expect(draws[0]?.args.slice(1)).toEqual([0, -50, 200, 200]);
    });
  });

  describe('repeat', () => {
    it('repeat tiles the image across the block', () => {
      // 50×50 image, 200×100 block, size=auto → 4×2 = 8 tiles minimum,
      // starting from (0,0) since position defaults to 0% 0%.
      const mock = createMockCanvasContext();
      const bitmap = makeBitmap(50, 50);
      const block = makeBlock({
        backgroundImage: HREF,
        backgroundSize: 'auto',
        backgroundRepeat: 'repeat',
      });
      renderBlockBackground(mock.ctx, block, 0, 0, { rx: 0, ry: 0 }, imageMap(HREF, bitmap));
      const draws = calls(mock.records).filter((c) => c.method === 'drawImage');
      // Tile grid: columns at x=0,50,100,150; rows at y=0,50. → 4 × 2 = 8
      expect(draws).toHaveLength(8);
    });

    it('no-repeat draws exactly one tile', () => {
      const mock = createMockCanvasContext();
      const block = makeBlock({
        backgroundImage: HREF,
        backgroundSize: 'auto',
        backgroundRepeat: 'no-repeat',
      });
      renderBlockBackground(
        mock.ctx,
        block,
        0,
        0,
        { rx: 0, ry: 0 },
        imageMap(HREF, makeBitmap(50, 50)),
      );
      const draws = calls(mock.records).filter((c) => c.method === 'drawImage');
      expect(draws).toHaveLength(1);
    });
  });

  it('missing image map returns early (no drawImage)', () => {
    const mock = createMockCanvasContext();
    const block = makeBlock({
      backgroundImage: HREF,
      backgroundSize: 'cover',
    });
    renderBlockBackground(mock.ctx, block, 0, 0, { rx: 0, ry: 0 });
    const draws = calls(mock.records).filter((c) => c.method === 'drawImage');
    expect(draws).toHaveLength(0);
  });

  it('href not found in images map → no drawImage', () => {
    const mock = createMockCanvasContext();
    const block = makeBlock({
      backgroundImage: 'missing.png',
      backgroundSize: 'cover',
    });
    renderBlockBackground(mock.ctx, block, 0, 0, { rx: 0, ry: 0 }, images);
    const draws = calls(mock.records).filter((c) => c.method === 'drawImage');
    expect(draws).toHaveLength(0);
  });
});
