import type { LayoutConfig, ReaderLocator, ReaderSourcePoint, Rect } from '../../../reader';
import {
  RitoReaderError,
  type BrowserReaderLocator,
  type BrowserReaderSourceRange,
} from '../reader-session';
import type { SessionReaderLayoutView } from './layout-view';
import { sessionReaderClosed, type SessionReaderState } from './state';

type SessionSourcePoint = BrowserReaderSourceRange['start'];

/**
 * The committed layout an interaction is asked of and answered in. Every
 * live artifact names its revision, so the visible one asks for any page.
 */
export interface SessionReaderCapture {
  readonly generation: number;
  readonly view: SessionReaderLayoutView;
  readonly config: LayoutConfig;
  readonly artifactId: bigint;
}

/** Where a page sits: the spread that draws it and its content origin there. */
export interface SessionReaderPagePlace {
  readonly spreadIndex: number;
  readonly originX: number;
  readonly originY: number;
}

export function captureSessionReaderLayout(state: SessionReaderState): SessionReaderCapture {
  return {
    generation: state.layoutGeneration,
    view: state.view,
    config: state.geometry,
    artifactId: state.visible.artifact.artifactId,
  };
}

/**
 * Asks the session about the committed layout. Resolves undefined when the
 * reader is closed or the layout was replaced before the answer arrived:
 * page indexes and geometry of an answer belong to the layout it was asked of.
 */
export async function askSessionReaderLayout<T>(
  state: SessionReaderState,
  ask: (capture: SessionReaderCapture) => Promise<T>,
): Promise<T | undefined> {
  if (state.disposed) return undefined;
  const capture = captureSessionReaderLayout(state);
  let answer: T;
  try {
    answer = await ask(capture);
  } catch (error) {
    // A layout being replaced retires the artifact the question named.
    if (sessionReaderClosed(state) || isSessionReaderError(error, 'unknown-artifact')) {
      return undefined;
    }
    throw error;
  }
  if (sessionReaderClosed(state) || capture.generation !== state.layoutGeneration) return undefined;
  return answer;
}

export function isSessionReaderError(error: unknown, code: RitoReaderError['code']): boolean {
  return error instanceof RitoReaderError && error.code === code;
}

/**
 * A page's place in the layout. The session speaks the display-list space
 * of the spread that draws a page; a reader speaks page-content
 * coordinates. The two differ by the page's content origin in its spread:
 * the margins, and for the second page one page and the gap — the geometry
 * `getLayoutGeometry()` publishes for hosts to map pointers with.
 */
export function sessionReaderPagePlace(
  capture: Pick<SessionReaderCapture, 'view' | 'config'>,
  pageIndex: number,
): SessionReaderPagePlace | undefined {
  const spreadIndex = capture.view.spreadIndexByPage[pageIndex];
  const spread = spreadIndex === undefined ? undefined : capture.view.spreads[spreadIndex];
  if (spreadIndex === undefined || spread === undefined) return undefined;
  const { config } = capture;
  const second = spread.pageIndexes.indexOf(pageIndex) > 0;
  return {
    spreadIndex,
    originX: (second ? config.pageWidth + config.spreadGap : 0) + config.marginLeft,
    originY: config.marginTop,
  };
}

export function sessionReaderPageRect(place: SessionReaderPagePlace, bounds: Rect): Rect {
  return {
    x: bounds.x - place.originX,
    y: bounds.y - place.originY,
    width: bounds.width,
    height: bounds.height,
  };
}

export function readerSourcePoint(point: SessionSourcePoint): ReaderSourcePoint {
  return { nodePath: [...point.nodePath], textOffset: Number(point.textOffset) };
}

export function sessionSourcePoint(point: ReaderSourcePoint): SessionSourcePoint {
  return { nodePath: [...point.nodePath], textOffset: BigInt(point.textOffset) };
}

export function readerLocator(locator: BrowserReaderLocator): ReaderLocator {
  return {
    href: locator.href,
    ...(locator.anchorId === undefined ? {} : { anchorId: locator.anchorId }),
    ...(locator.sourcePoint === undefined
      ? {}
      : { sourcePoint: readerSourcePoint(locator.sourcePoint) }),
    ...(locator.sourceRange === undefined
      ? {}
      : {
          sourceRange: {
            start: readerSourcePoint(locator.sourceRange.start),
            end: readerSourcePoint(locator.sourceRange.end),
          },
        }),
    ...(locator.progression === undefined ? {} : { progression: locator.progression }),
  };
}

export function requireSessionReaderPageIndex(pageIndex: number): void {
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) {
    throw new TypeError('Reader interaction pageIndex must be a non-negative safe integer');
  }
}
