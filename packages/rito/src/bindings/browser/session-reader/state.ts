import type { LayoutConfig, Reader, ReaderOptions, Spread } from '../../../reader';
import type { BrowserHostLogger } from '../host-runtime';
import type { ReaderEventLog } from '../reader-event-log';
import type { CanvasRenderingTarget } from '../primitive-renderer';
import type { BrowserReaderArtifact, BrowserReaderSession } from '../reader-session';
import type {
  BrowserReaderCanvasPresenter,
  BrowserReaderPreparedCanvasArtifact,
} from '../reader-session-canvas';
import type { SessionReaderHostFonts } from './host-fonts';
import type { SessionReaderLayoutView } from './layout-view';
import type { SessionReaderPublication } from './publication';

/** One spread of the committed layout, ready to paint. */
export interface SessionReaderFrame {
  readonly spreadIndex: number;
  readonly artifact: BrowserReaderArtifact;
  readonly prepared: BrowserReaderPreparedCanvasArtifact;
  /**
   * Whether the session still takes the artifact as a turn target. An
   * artifact that has been the visible one is not taken again: returning to
   * its spread asks the session for the spread anew.
   */
  committable: boolean;
  stopWatchingImages(): void;
}

export interface SessionReaderTypography {
  fontSize: number | undefined;
  lineHeight: number | undefined;
  lineHeightForce: boolean;
  fontFamily: string | undefined;
  fontFamilyForce: boolean;
}

/**
 * A reader's work on its session's artifacts, one operation at a time.
 * `asked` holds what the reader was asked to do (follow the host to a
 * spread, lay out again) and `ahead` the spreads loaded before they are
 * shown; an operation asked for runs before one loaded ahead.
 */
export interface SessionReaderQueue {
  readonly asked: (() => Promise<void>)[];
  readonly ahead: (() => Promise<void>)[];
  running: boolean;
  /**
   * What the queue does when nothing waits: one step of the whole-book
   * layout. Resolves whether another step is wanted.
   */
  idle: () => Promise<boolean>;
}

export interface SessionReaderState {
  readonly session: BrowserReaderSession;
  readonly presenter: BrowserReaderCanvasPresenter;
  readonly hostFonts: SessionReaderHostFonts;
  readonly publication: SessionReaderPublication;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly ctx: CanvasRenderingTarget;
  readonly logger: BrowserHostLogger;
  /** What this reader asked its session and was answered, for a report of something going wrong. */
  readonly log: ReaderEventLog;
  /** The layout options as last requested; a layout in flight may not have committed them. */
  options: ReaderOptions;
  readonly typography: SessionReaderTypography;
  /** Geometry of the committed layout. */
  config: LayoutConfig;
  readonly dpr: number;
  bgColor: string;
  fgColor: string | undefined;
  /** The committed page table. */
  view: SessionReaderLayoutView;
  /** Loaded spreads of the committed layout, by spread index. */
  frames: Map<number, SessionReaderFrame>;
  /** Spread loads queued or under way, by spread index. */
  readonly pendingFrames: Map<number, Promise<SessionReaderFrame | undefined>>;
  /** The spread the session shows: every turn, layout and adoption replaces it by compare-and-swap. */
  visible: SessionReaderFrame;
  /** The spread the host shows; the session follows it. */
  activeSpreadIndex: number;
  /** Counts layout commits; an answer for an older one is dropped. */
  layoutGeneration: number;
  /** Counts layout requests; only the latest commits. */
  relayoutToken: number;
  /** Holds on the whole-book layout the host has not released; it waits while any stands. */
  bookHolds: number;
  readonly queue: SessionReaderQueue;
  showQueued: boolean;
  relayoutForced: boolean;
  /** Whole-book steps in a row that brought no page for the committed layout. */
  bookIdleSteps: number;
  /** A whole-book step failed; the next thing the reader is asked to do tries again. */
  bookStalled: boolean;
  /** Publication faces the browser refused to decode, by the family artifacts list them under. */
  readonly rejectedFontFamilies: Set<string>;
  readonly bookWaiters: Set<() => void>;
  readonly spreadRenderedListeners: Set<(spreadIndex: number, spread: Spread) => void>;
  readonly spreadContentInvalidatedListeners: Set<(spreadIndex: number) => void>;
  readonly layoutCommittedListeners: Set<(activeSpreadIndex: number) => void>;
  disposed: boolean;
}

/**
 * Whether the reader was closed. Asked afresh after every wait: a reader
 * can be closed while any of its session calls is in flight.
 */
export function sessionReaderClosed(state: SessionReaderState): boolean {
  return state.disposed;
}

export function notifySessionReaderSpreadInvalidated(
  state: SessionReaderState,
  spreadIndex: number,
): void {
  if (state.disposed) return;
  for (const listener of state.spreadContentInvalidatedListeners) listener(spreadIndex);
}

/** The reader's listener registrations: each returns its removal. */
export function sessionReaderListenerMethods(
  state: SessionReaderState,
): Pick<Reader, 'onSpreadRendered' | 'onSpreadContentInvalidated' | 'onLayoutCommitted'> {
  return {
    onSpreadRendered(listener) {
      state.spreadRenderedListeners.add(listener);
      return () => state.spreadRenderedListeners.delete(listener);
    },
    onSpreadContentInvalidated(listener) {
      state.spreadContentInvalidatedListeners.add(listener);
      return () => state.spreadContentInvalidatedListeners.delete(listener);
    },
    onLayoutCommitted(listener) {
      state.layoutCommittedListeners.add(listener);
      return () => state.layoutCommittedListeners.delete(listener);
    },
  };
}
