/**
 * Centralised coordinate-space conversions for the controller layer.
 *
 * Coordinate spaces (see COORDINATE_SYSTEM_REMEDIATION.md):
 *
 *   page-content      – layout primitives; origin = page content top-left (no margins)
 *   spread-content    – synthetic space fed to SelectionEngine (content areas + content gap)
 *   viewport-logical  – rendered spread; origin = canvas logical top-left (includes margins)
 *   display-css       – CSS pixels on screen (viewport-logical × renderScale)
 *   screen            – browser viewport (display-css + canvas bounding rect)
 *
 * Every offset formula lives here — no other file should hard-code margin/gap arithmetic.
 */

import type { LayoutConfig, Spread } from 'rito';
import type { Rect } from 'rito/advanced';
import { buildSelectionConfig } from './selection-config';
import { resolveSpreadPage } from './page-resolution';
import { spreadContentRectToViewport, toViewport, scaleRect, toScreen } from './rect-projection';

// ── Public types ─────────────────────────────────────────────────────

export interface LayoutGeometry {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly marginTop: number;
  readonly marginRight: number;
  readonly marginBottom: number;
  readonly marginLeft: number;
  readonly spreadGap: number;
  readonly spreadMode: 'single' | 'double';
}

export interface PageGeometry {
  readonly pageIndex: number;
  readonly side: 'left' | 'right' | 'single';
  /** Content-area origin X in viewport-logical space. */
  readonly contentOriginX: number;
  /** Content-area origin Y in viewport-logical space. */
  readonly contentOriginY: number;
  /** Content-area origin X in spread-content space. */
  readonly spreadContentOriginX: number;
  readonly contentWidth: number;
  readonly contentHeight: number;
}

export interface CoordinateMapper {
  readonly layout: LayoutGeometry;
  /** Synthetic LayoutConfig for SelectionEngine (pageWidth = contentWidth). */
  readonly selectionConfig: LayoutConfig;
  /** Pages in the current spread, keyed by pageIndex. */
  getPage(pageIndex: number): PageGeometry | undefined;
  /** All page geometries in the current spread. */
  getPages(): readonly PageGeometry[];

  // ── Pointer conversion chain ─────────────────────────────────────
  /** display-css → spread-content. */
  cssToSpreadContent(cssX: number, cssY: number): { x: number; y: number };
  /** spread-content → page-content (resolves which page the point is on). */
  spreadContentToPage(x: number, y: number): { pageIndex: number; x: number; y: number } | null;

  // ── Render / UI conversion chain ─────────────────────────────────
  /** spread-content rect → viewport-logical rect (adds margins). */
  spreadContentRectToViewport(rect: Rect): Rect;
  /** page-content rect → viewport-logical rect. */
  pageContentToViewport(pageIndex: number, rect: Rect): Rect;
  /** viewport-logical rect → display-css rect. */
  viewportToDisplay(rect: Rect): Rect;
  /** page-content rect → screen rect (needs live canvas rect). */
  pageContentToScreen(
    pageIndex: number,
    rect: Rect,
    canvasRect: { left: number; top: number },
  ): Rect;
}

// ── Factory ──────────────────────────────────────────────────────────

export function createCoordinateMapper(
  config: LayoutConfig,
  spread: Spread,
  renderScale: number,
): CoordinateMapper {
  const g = extractGeometry(config);
  const contentWidth = g.pageWidth - g.marginLeft - g.marginRight;
  const contentHeight = g.pageHeight - g.marginTop - g.marginBottom;
  const contentGap = g.marginLeft + g.spreadGap + g.marginRight;

  const pages = buildPageGeometries(spread, g, contentWidth, contentHeight, contentGap);
  const pageMap = new Map(pages.map((p) => [p.pageIndex, p]));
  const selectionCfg = buildSelectionConfig(g, contentWidth, contentHeight, contentGap);

  return buildMapperObject(g, selectionCfg, pages, pageMap, renderScale);
}

function buildMapperObject(
  g: LayoutGeometry,
  selectionConfig: LayoutConfig,
  pages: readonly PageGeometry[],
  pageMap: ReadonlyMap<number, PageGeometry>,
  renderScale: number,
): CoordinateMapper {
  return {
    layout: g,
    selectionConfig,
    getPage: (pageIndex) => pageMap.get(pageIndex),
    getPages: () => pages,
    cssToSpreadContent: (cssX, cssY) => ({
      x: cssX / renderScale - g.marginLeft,
      y: cssY / renderScale - g.marginTop,
    }),
    spreadContentToPage: (x, y) => resolveSpreadPage(pages, x, y),
    spreadContentRectToViewport: (rect) => spreadContentRectToViewport(g, rect),
    pageContentToViewport: (pageIndex, rect) => toViewport(pageMap, pageIndex, rect),
    viewportToDisplay: (rect) => scaleRect(rect, renderScale),
    pageContentToScreen: (pageIndex, rect, canvasRect) =>
      toScreen(pageMap, pageIndex, rect, canvasRect, renderScale),
  };
}

// ── Internals ────────────────────────────────────────────────────────

function extractGeometry(config: LayoutConfig): LayoutGeometry {
  return {
    viewportWidth: config.viewportWidth,
    viewportHeight: config.viewportHeight,
    pageWidth: config.pageWidth,
    pageHeight: config.pageHeight,
    marginTop: config.marginTop,
    marginRight: config.marginRight,
    marginBottom: config.marginBottom,
    marginLeft: config.marginLeft,
    spreadGap: config.spreadGap,
    spreadMode: config.spreadMode,
  };
}

function buildPageGeometries(
  spread: Spread,
  g: LayoutGeometry,
  contentWidth: number,
  contentHeight: number,
  contentGap: number,
): PageGeometry[] {
  const pages: PageGeometry[] = [];

  if (spread.left) {
    pages.push({
      pageIndex: spread.left.index,
      side: g.spreadMode === 'double' ? 'left' : 'single',
      contentOriginX: g.marginLeft,
      contentOriginY: g.marginTop,
      spreadContentOriginX: 0,
      contentWidth,
      contentHeight,
    });
  }

  if (spread.right) {
    pages.push({
      pageIndex: spread.right.index,
      side: 'right',
      contentOriginX: g.pageWidth + g.spreadGap + g.marginLeft,
      contentOriginY: g.marginTop,
      spreadContentOriginX: contentWidth + contentGap,
      contentWidth,
      contentHeight,
    });
  }

  return pages;
}
