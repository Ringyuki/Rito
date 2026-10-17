import type { FootnoteEntry, ReaderDocumentSourceSpan, ReaderLocator, Spread } from '@ritojs/core';
import type {
  AnnotationRecord,
  ReadingPosition,
  Rect,
  ResolvedAnnotation,
  SearchResult,
} from '../interaction/index';
import type { SelectionHandleState } from './types';

/** What the controller tells its host, by event name. */
export interface ReaderControllerEvents {
  spreadChange: { spreadIndex: number; spread: Spread };
  selectionChange: {
    /** Durable source locator of the selection, when both endpoints share a resource. */
    sourceLocator: ReaderLocator | null;
    /** Resource-qualified durable endpoints of the selection. */
    sourceSpan: ReaderDocumentSourceSpan | null;
    hasSelection: boolean;
    text: string;
    /** Selection rects in spread-content space (content areas only, no margins). */
    rects: readonly Rect[];
    /** Selection rects in viewport-logical space (includes margins, ready for overlay/UI). */
    viewportRects: readonly Rect[];
    /** Rect of the active endpoint (focus / drag end) in viewport-logical space. Follows the user's pointer. */
    focusRect: Rect | null;
    /** Exact range endpoints in viewport-logical space. */
    handles: SelectionHandleState | null;
  };
  searchResults: { results: readonly SearchResult[]; activeIndex: number };
  searchActiveChange: { activeIndex: number; result: SearchResult | undefined };
  annotationsChange: { annotations: readonly AnnotationRecord[] };
  /**
   * Annotation click, in **screen** coordinates (suitable for CSS `position: fixed`) like
   * `imageClick.screenBounds`. `screenBounds` boxes the annotation's lines on the clicked
   * page, so a popover can sit above or below them; `x`, `y` is the box's top centre.
   */
  annotationClick: { annotation: ResolvedAnnotation; x: number; y: number; screenBounds: Rect };
  /** Annotation hover event. `x` and `y` are in **screen** coordinates (suitable for CSS `position: fixed`). */
  annotationHover: { annotation: ResolvedAnnotation | null; x: number; y: number };
  positionChange: { position: ReadingPosition };
  layoutChange: { spreads: readonly Spread[]; totalSpreads: number };
  /** A page turn became visible. Exactly one `transitionEnd` follows. */
  transitionStart: { direction: 'forward' | 'backward' };
  /**
   * A frame of the visible turn was painted. `progress` is how far the page
   * has moved toward its neighbour: 0 at rest, 1 on arrival (a pull against
   * the first or last page reports its rubber-band travel).
   */
  transitionProgress: { direction: 'forward' | 'backward'; progress: number };
  /**
   * The visible turn ended: it landed (`committed`), went back (`cancelled`),
   * or was cut off by a relayout or a jump (`interrupted`). A newer turn
   * settles the one in flight at once and takes its picture on from there.
   */
  transitionEnd: {
    direction: 'forward' | 'backward';
    outcome: 'committed' | 'cancelled' | 'interrupted';
  };
  /** Link clicked. Call `navigate()` to execute internal navigation. */
  linkClick: {
    href: string;
    text: string;
    type: 'internal' | 'external';
    /** Resolved chapter/section label from TOC (internal links only). */
    resolvedLabel?: string | undefined;
    /** For internal links: call to navigate to the target spread. */
    navigate: () => void;
  };
  /** Footnote reference clicked. `content` has the footnote entry. */
  footnoteClick: {
    id: string;
    href: string;
    content: FootnoteEntry;
  };
  /** Image clicked. `screenBounds` is in screen coordinates for lightbox positioning. */
  imageClick: {
    src: string;
    alt: string;
    /** Controller-owned object URL, valid until the next image click or controller disposal. */
    blobUrl: string;
    screenBounds: Rect;
  };
  /** Emitted when the search keyboard shortcut is pressed. UI layer should open the search bar. */
  searchOpen: undefined;
  error: { message: string; source: string };
}
