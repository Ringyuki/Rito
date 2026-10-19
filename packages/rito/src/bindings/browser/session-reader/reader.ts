import type { Reader, ReaderOptions, ReaderPublication } from '../../../reader';
import { createBrowserHostLogger } from '../host-runtime';
import {
  openReaderEventLog,
  recordReaderLogger,
  recordReaderSession,
  type ReaderEventLog,
} from '../reader-event-log';
import { openBrowserReaderSession, type BrowserReaderSession } from '../reader-session';
import { lazyCanvasContext } from '../lazy-canvas-context';
import { createBrowserReaderSessionCanvasPresenter } from '../reader-session-canvas';
import { adoptSessionReaderFirstFrame, readSessionReaderLayout } from './artifacts';
import { holdSessionReaderBook, stepSessionReaderBook } from './background';
import { commitSessionReaderLayout } from './commit';
import { installSessionReaderDiagnostics } from './diagnostics';
import {
  scheduleSessionReaderRelayout,
  sessionReaderAppearanceMethods,
  sessionReaderGeometryMethods,
} from './foreground';
import { SessionReaderHostFonts } from './host-fonts';
import { createSessionReaderInteractions } from './interactions';
import { sessionReaderLayoutConfig, sessionReaderSessionLayout } from './layout-options';
import { EMPTY_SESSION_READER_LAYOUT_VIEW } from './layout-view';
import { sessionLocator, sessionReaderNavigationMethods } from './navigation';
import { createSessionReaderPublication } from './publication';
import { createSessionReaderQueue, wakeSessionReaderQueue } from './queue';
import { rejectSessionReaderFont } from './rejected-fonts';
import { sessionReaderRenderingMethods } from './render';
import { sessionReaderResourceMethods } from './resources';
import {
  sessionReaderListenerMethods,
  type SessionReaderState,
  type SessionReaderTypography,
} from './state';

type PinnedFontPolicy = NonNullable<ReaderOptions['pinnedFontPolicy']>;

/**
 * Opens a book on a reader session: the chapter being read is laid out and
 * shown first, and the whole book follows in the background.
 */
export async function createReader(
  data: ReaderPublication,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: ReaderOptions,
): Promise<Reader> {
  const policy = options.pinnedFontPolicy;
  if (policy === undefined || policy.faces.length === 0) {
    throw new Error(
      'createReader requires a pinnedFontPolicy with at least one face: the engine ' +
        'shapes text with those exact font bytes and cannot start without them',
    );
  }
  const { pinnedFontPolicy: _policy, ...layoutOptions } = options;
  const typography = initialTypography(options);
  const config = sessionReaderLayoutConfig(layoutOptions, typography);
  const dpr = options.devicePixelRatio ?? fallbackDevicePixelRatio();
  const log = openReaderEventLog();
  const layout = sessionReaderSessionLayout(config, dpr);
  const initialLocator = options.initialLocator
    ? sessionLocator(options.initialLocator)
    : { href: '' };
  // The faces by their SHA-256, which the engine checks their bytes against.
  log.note(
    'pinnedFaces',
    policy.faces.map((face) => face.expectedSha256),
  );
  const opened = log.begin('openSession', { layout, initialLocator });
  const opening = openBrowserReaderSession(data, {
    initialLocator,
    layout,
    pinnedFontPolicy: sessionPinnedFontPolicy(policy),
  });
  // The page registers the host faces while the engine opens the book.
  const hostFonts = new SessionReaderHostFonts();
  hostFonts.add(policy.faces);
  let session;
  try {
    session = recordReaderSession(await opening, log);
    opened.end(session.initialArtifact);
  } catch (error) {
    opened.fail(error);
    hostFonts.dispose();
    throw error;
  }
  try {
    const state = await openState(session, canvas, layoutOptions, typography, hostFonts, {
      dpr,
      log,
    });
    const layout = await readSessionReaderLayout(state, state.visible.artifact.artifactId);
    await commitSessionReaderLayout(state, { frame: state.visible, layout }, config);
    // A face the browser refused while the first page was prepared: the
    // book is laid out again without it, and the whole book follows that.
    if (state.rejectedFontFamilies.size > 0) scheduleSessionReaderRelayout(state, true);
    // The engine runs on the page's thread: each step of the whole book
    // waits for the page to paint and handle input first, so the steps are
    // the page's idle time.
    state.queue.idle = async () => {
      await yieldToPage();
      return stepSessionReaderBook(state);
    };
    // The first page reaches the screen before the whole book starts: the
    // book waits out the frame the host draws that page in.
    state.bookHolds += 1;
    const release = () => {
      state.bookHolds -= 1;
      wakeSessionReaderQueue(state);
    };
    if (typeof requestAnimationFrame !== 'function') void yieldToPage().then(release);
    else requestAnimationFrame(() => void yieldToPage().then(release));
    installSessionReaderDiagnostics(state);
    return buildReader(state);
  } catch (error) {
    hostFonts.dispose();
    await session.dispose().catch(() => undefined);
    throw error;
  }
}

/** Resolves once the page has had a turn: a task, not a microtask. */
function yieldToPage(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(undefined);
  });
}

async function openState(
  session: BrowserReaderSession,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: ReaderOptions,
  typography: SessionReaderTypography,
  hostFonts: SessionReaderHostFonts,
  { dpr, log }: { readonly dpr: number; readonly log: ReaderEventLog },
): Promise<SessionReaderState> {
  const opened: { state?: SessionReaderState } = {};
  const presenter = createBrowserReaderSessionCanvasPresenter(session, {
    hostFont: (font) => hostFonts.resolve(font),
    fontRejected: (font, error) => {
      if (opened.state) rejectSessionReaderFont(opened.state, font.family, error);
    },
  });
  const state = {
    session,
    presenter,
    hostFonts,
    canvas,
    canvasContext: lazyCanvasContext(canvas),
    logger: recordReaderLogger(createBrowserHostLogger(options.logLevel ?? 'warn'), log),
    log,
    options,
    typography,
    config: sessionReaderLayoutConfig(options, typography),
    geometry: sessionReaderLayoutConfig(options, typography),
    dpr,
    bgColor: options.backgroundColor ?? '#ffffff',
    fgColor: options.foregroundColor ?? undefined,
    ...idleState(),
  } as unknown as SessionReaderState;
  opened.state = state;
  const [publication, frame] = await Promise.all([
    session.readPublication(),
    adoptSessionReaderFirstFrame(state),
  ]);
  return Object.assign(state, {
    publication: createSessionReaderPublication(publication),
    visible: frame,
    frames: new Map([[frame.spreadIndex, frame]]),
    activeSpreadIndex: frame.spreadIndex,
  });
}

/** The parts of a reader's state that start empty and idle. */
function idleState(): Partial<SessionReaderState> {
  return {
    view: EMPTY_SESSION_READER_LAYOUT_VIEW,
    frames: new Map(),
    pendingFrames: new Map(),
    activeSpreadIndex: 0,
    layoutGeneration: 0,
    relayoutToken: 0,
    bookHolds: 0,
    queue: createSessionReaderQueue(),
    showQueued: false,
    relayoutForced: false,
    bookIdleSteps: 0,
    bookStalled: false,
    rejectedFontFamilies: new Set(),
    bookWaiters: new Set(),
    spreadRenderedListeners: new Set(),
    spreadContentInvalidatedListeners: new Set(),
    layoutCommittedListeners: new Set(),
    disposed: false,
  };
}

function buildReader(state: SessionReaderState): Reader {
  const reader = {
    interactions: createSessionReaderInteractions(state),
    ...sessionReaderRenderingMethods(state),
    ...sessionReaderNavigationMethods(state),
    ...sessionReaderGeometryMethods(state),
    ...sessionReaderAppearanceMethods(state),
    ...sessionReaderListenerMethods(state),
    ...sessionReaderResourceMethods(state),
    getLayoutGeometry: () => state.geometry,
    holdBookLayout: () => holdSessionReaderBook(state),
    dispose() {
      if (state.disposed) return Promise.resolve();
      state.disposed = true;
      state.log.note('dispose');
      for (const resume of [...state.bookWaiters]) resume();
      state.bookWaiters.clear();
      try {
        state.presenter.dispose();
      } catch (error) {
        state.logger.warn('reader paint resources did not release cleanly', error);
      }
      state.hostFonts.dispose();
      return state.session.dispose();
    },
  };
  Object.defineProperties(reader, {
    metadata: { enumerable: true, get: () => state.publication.metadata },
    totalSpreads: { enumerable: true, get: () => state.view.spreads.length },
    pageCount: { enumerable: true, get: () => state.view.pageCount },
    activeSpreadIndex: { enumerable: true, get: () => state.activeSpreadIndex },
    toc: { enumerable: true, get: () => state.publication.toc },
    chapterMap: { enumerable: true, get: () => state.view.chapterMap },
    manifestHrefMap: { enumerable: true, get: () => state.publication.manifestHrefMap },
    spreads: { enumerable: true, get: () => state.view.spreads },
    dpr: { enumerable: true, get: () => state.dpr },
    layoutScope: { enumerable: true, get: () => state.view.scope },
  });
  return reader as unknown as Reader;
}

function initialTypography(options: ReaderOptions): SessionReaderTypography {
  return {
    fontSize: options.fontSize,
    lineHeight: options.lineHeight,
    lineHeightForce: options.lineHeightForce ?? false,
    fontFamily: options.fontFamily,
    fontFamilyForce: options.fontFamilyForce ?? false,
  };
}

function sessionPinnedFontPolicy(policy: PinnedFontPolicy): {
  readonly metadataJson: string;
  readonly faces: readonly Uint8Array[];
} {
  return {
    metadataJson: JSON.stringify({
      schemaVersion: policy.schemaVersion,
      faces: policy.faces.map((face) => ({
        expectedSha256: face.expectedSha256,
        genericRole: face.genericRole,
        ...(face.language === undefined ? {} : { language: face.language }),
      })),
    }),
    faces: policy.faces.map((face) => new Uint8Array(face.bytes)),
  };
}

function fallbackDevicePixelRatio(): number {
  return typeof window !== 'undefined' ? window.devicePixelRatio : 1;
}
