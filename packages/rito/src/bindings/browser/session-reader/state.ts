import type { LayoutConfig, ReaderOptions, Spread } from '../../../reader';
import type { BrowserHostLogger } from '../host-runtime';
import type { ReaderEventLog } from '../reader-event-log';
import type { CanvasRenderingTarget } from '../primitive-renderer';
import {
  RitoReaderError,
  type BrowserReaderArtifact,
  type BrowserReaderSession,
} from '../reader-session';
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
  readonly pendingFrames: Map<number, Promise<SessionReaderFrame | undefined>>;
  /** The spread the session shows: every turn, layout and adoption replaces it by compare-and-swap. */
  visible: SessionReaderFrame;
  /** The spread the host shows; the session follows it. */
  activeSpreadIndex: number;
  /** Counts layout commits; work begun under an older one is dropped. */
  layoutGeneration: number;
  /** Counts layout requests; only the latest commits. */
  relayoutToken: number;
  /** Counts whole-book runs; a layout request ends the run of the layout it replaces. */
  backgroundToken: number;
  /** Turns, layouts and adoptions run one at a time, in order. */
  foreground: Promise<void>;
  /** Spread loads run one at a time, so the live-artifact budget is counted exactly. */
  frameLoads: Promise<void>;
  /** Whole-book runs, one after another. */
  background: Promise<void>;
  showQueued: boolean;
  relayoutQueued: boolean;
  relayoutForced: boolean;
  /** Layout requests in a row the session refused for now; a commit ends the row. */
  relayoutRefusals: number;
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

/** Runs `operation` after every foreground operation queued before it. */
export function runSessionReaderForeground(
  state: SessionReaderState,
  operation: () => Promise<void>,
): Promise<void> {
  const run = state.foreground.then(async () => {
    if (sessionReaderClosed(state)) return;
    try {
      await operation();
    } catch (error) {
      if (!sessionReaderClosed(state)) state.logger.warn('reader session operation failed', error);
    }
  });
  state.foreground = run;
  return run;
}

/** How long a request the session refused for now waits before it is made again. */
export const SESSION_READER_RETRY_DELAY_MS = 16;
const REFUSED_FOR_NOW = new Set<string>([
  'stale-request',
  'request-busy',
  'artifact-capacity',
  'request-capacity',
]);

/**
 * Whether the session refused a request only for now: it was occupied, out
 * of artifact slots, or overtaken. The same request made again is answered.
 */
export function sessionReaderRefusedForNow(error: unknown): boolean {
  return error instanceof RitoReaderError && REFUSED_FOR_NOW.has(error.code);
}

export function notifySessionReaderSpreadInvalidated(
  state: SessionReaderState,
  spreadIndex: number,
): void {
  if (state.disposed) return;
  for (const listener of state.spreadContentInvalidatedListeners) listener(spreadIndex);
}
