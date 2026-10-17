import type { Reader } from '@ritojs/core';
import { createCoordinateMapper, type PageGeometry } from './geometry/coordinate-mapper';
import type { Rect } from '../interaction/index';

/** One page as a {@link PagePainter} draws on it. Lengths are layout CSS pixels. */
export interface PagePaint {
  /** The page in the committed layout. */
  readonly pageIndex: number;
  /**
   * The page's zero-based number in the whole book, and the book's page
   * count. Both are null while only the chapter being read is laid out:
   * page indexes then count from that chapter, so hide page numbering
   * rather than show a wrong number. The whole book's layout paints every
   * page again with both.
   */
  readonly bookPageIndex: number | null;
  readonly bookPageCount: number | null;
  readonly side: 'left' | 'right' | 'single';
  /** The page's size; the context's origin is its top-left corner. */
  readonly width: number;
  readonly height: number;
  /** The page's margins around its text. */
  readonly margins: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
}

/**
 * Draws over one page after the engine has painted it, into the page's own
 * picture: what it draws moves with the page through every turn and sits
 * under highlights. The context is clipped to the page, in layout CSS
 * pixels, and restored afterwards.
 *
 * Called whenever the controller paints a page, which includes the pages
 * on either side of the one on screen, painted ahead of a turn: draw from
 * `page`, not from where the reader is. Call `repaintPages()` when what
 * the painter draws changes on its own.
 */
export type PagePainter = (context: OffscreenCanvasRenderingContext2D, page: PagePaint) => void;

/**
 * Runs the host's painter over each page of a spread just painted. A
 * painter that throws is reported and leaves the page as the engine
 * painted it: nothing a host draws may hold a page back.
 */
export function paintPagesOver(
  painter: PagePainter,
  spreadIndex: number,
  context: OffscreenCanvasRenderingContext2D,
  reader: Reader,
  renderScale: number,
  onError: (error: unknown) => void,
): void {
  const spread = reader.spreads[spreadIndex];
  if (!spread) return;
  const mapper = createCoordinateMapper(reader.getLayoutGeometry(), spread, renderScale);
  const ratio = reader.dpr * renderScale;
  const whole = reader.layoutScope !== 'chapter';
  for (const page of mapper.getPages()) {
    const box = mapper.pageRect(page.pageIndex);
    if (!box) continue;
    const paint = pagePaint(page, box, mapper.layout, whole ? reader.pageCount : null);
    context.save();
    try {
      context.setTransform(ratio, 0, 0, ratio, box.x * ratio, box.y * ratio);
      context.beginPath();
      context.rect(0, 0, box.width, box.height);
      context.clip();
      painter(context, paint);
    } catch (error: unknown) {
      onError(error);
    } finally {
      context.restore();
    }
  }
}

function pagePaint(
  page: PageGeometry,
  box: Rect,
  layout: { marginTop: number; marginRight: number; marginBottom: number; marginLeft: number },
  bookPageCount: number | null,
): PagePaint {
  return {
    pageIndex: page.pageIndex,
    bookPageIndex: bookPageCount === null ? null : page.pageIndex,
    bookPageCount,
    side: page.side,
    width: box.width,
    height: box.height,
    margins: {
      top: layout.marginTop,
      right: layout.marginRight,
      bottom: layout.marginBottom,
      left: layout.marginLeft,
    },
  };
}
