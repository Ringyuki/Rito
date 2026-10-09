import type { Reader, ReaderOptions, ReaderPublication } from '../../../reader';
import { createBrowserHostLogger } from '../host-runtime';
import type { CanvasRenderingTarget } from '../primitive-renderer';
import { openBrowserReaderSession, type BrowserReaderSession } from '../reader-session';
import { createBrowserReaderSessionCanvasPresenter } from '../reader-session-canvas';
import { startSessionReaderBackground } from './background';
import { commitSessionReaderLayout, readSessionReaderLayout } from './commit';
import { scheduleSessionReaderRelayout } from './foreground';
import { prepareSessionReaderFrame } from './frames';
import { SessionReaderHostFonts } from './host-fonts';
import { createSessionReaderInteractions } from './interactions';
import { sessionReaderLayoutConfig, sessionReaderSessionLayout } from './layout-options';
import { EMPTY_SESSION_READER_LAYOUT_VIEW } from './layout-view';
import { sessionLocator, sessionReaderNavigationMethods } from './navigation';
import { createSessionReaderPublication } from './publication';
import { rejectSessionReaderFont } from './rejected-fonts';
import { sessionReaderRenderingMethods } from './render';
import { sessionReaderResourceMethods } from './resources';
import type { SessionReaderState, SessionReaderTypography } from './state';

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
  const ctx = canvas.getContext('2d') as CanvasRenderingTarget | null;
  if (!ctx) throw new Error('Rito reader core requires a 2D canvas context');
  const { pinnedFontPolicy: _policy, ...layoutOptions } = options;
  const typography = initialTypography(options);
  const config = sessionReaderLayoutConfig(layoutOptions, typography);
  const dpr = options.devicePixelRatio ?? fallbackDevicePixelRatio();
  const opening = openBrowserReaderSession(data, {
    initialLocator: options.initialLocator ? sessionLocator(options.initialLocator) : { href: '' },
    layout: sessionReaderSessionLayout(config, dpr),
    pinnedFontPolicy: sessionPinnedFontPolicy(policy),
  });
  // The page registers the host faces while the engine opens the book.
  const hostFonts = new SessionReaderHostFonts();
  hostFonts.add(policy.faces);
  let session;
  try {
    session = await opening;
  } catch (error) {
    hostFonts.dispose();
    throw error;
  }
  try {
    const state = await openState(session, canvas, ctx, layoutOptions, typography, dpr, hostFonts);
    const layout = await readSessionReaderLayout(state, state.visible);
    commitSessionReaderLayout(state, state.visible, layout, config);
    // A face the browser refused while the first page was prepared: the
    // book is laid out again without it, and the whole book follows that.
    if (state.rejectedFontFamilies.size > 0) scheduleSessionReaderRelayout(state, true);
    else startSessionReaderBackground(state);
    return buildReader(state);
  } catch (error) {
    hostFonts.dispose();
    await session.dispose().catch(() => undefined);
    throw error;
  }
}

async function openState(
  session: BrowserReaderSession,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  ctx: CanvasRenderingTarget,
  options: ReaderOptions,
  typography: SessionReaderTypography,
  dpr: number,
  hostFonts: SessionReaderHostFonts,
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
    ctx,
    logger: createBrowserHostLogger(options.logLevel ?? 'warn'),
    options,
    typography,
    config: sessionReaderLayoutConfig(options, typography),
    dpr,
    bgColor: options.backgroundColor ?? '#ffffff',
    fgColor: options.foregroundColor ?? undefined,
    ...idleState(),
  } as unknown as SessionReaderState;
  opened.state = state;
  const [publication, frame] = await Promise.all([
    session.readPublication(),
    prepareSessionReaderFrame(state, session.initialArtifact, false),
  ]);
  await session.adoptForegroundCandidate(undefined, frame.artifact.artifactId);
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
    backgroundToken: 0,
    foreground: Promise.resolve(),
    frameLoads: Promise.resolve(),
    background: Promise.resolve(),
    showQueued: false,
    relayoutQueued: false,
    relayoutForced: false,
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
    ...layoutMethods(state),
    ...listenerMethods(state),
    ...sessionReaderResourceMethods(state),
    getLayoutGeometry: () => state.config,
    getFootnotes: () => new Map(),
    dispose() {
      if (state.disposed) return Promise.resolve();
      state.disposed = true;
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

function layoutMethods(
  state: SessionReaderState,
): Pick<Reader, 'resize' | 'setSpreadMode' | 'updateLayout' | 'setTheme' | 'setTypography'> {
  return {
    resize(width, height) {
      state.options = { ...state.options, width, height };
      scheduleSessionReaderRelayout(state);
    },
    setSpreadMode(mode) {
      state.options = { ...state.options, spread: mode };
      scheduleSessionReaderRelayout(state);
      return false;
    },
    updateLayout(width, height, spreadMode, margin) {
      state.options = {
        ...state.options,
        width,
        height,
        ...(spreadMode === undefined ? {} : { spread: spreadMode }),
        ...(margin === undefined ? {} : { margin }),
      };
      scheduleSessionReaderRelayout(state);
      return false;
    },
    setTheme(theme) {
      const { bgColor, fgColor } = state;
      if (theme.backgroundColor !== undefined) state.bgColor = theme.backgroundColor ?? '#ffffff';
      if (theme.foregroundColor !== undefined) state.fgColor = theme.foregroundColor ?? undefined;
      if (state.bgColor === bgColor && state.fgColor === fgColor) return;
      // Colours are read at paint time, so every loaded spread stays valid
      // but nothing repaints on its own: the invalidation is the cue.
      for (const listener of state.spreadContentInvalidatedListeners) {
        listener(state.activeSpreadIndex);
      }
    },
    setTypography(next) {
      const { typography } = state;
      if (next.fontSize !== undefined) typography.fontSize = next.fontSize ?? undefined;
      if (next.lineHeight !== undefined) typography.lineHeight = next.lineHeight ?? undefined;
      if (next.lineHeightForce !== undefined) typography.lineHeightForce = next.lineHeightForce;
      if (next.fontFamily !== undefined) typography.fontFamily = next.fontFamily ?? undefined;
      if (next.fontFamilyForce !== undefined) typography.fontFamilyForce = next.fontFamilyForce;
      scheduleSessionReaderRelayout(state);
      return false;
    },
  };
}

function listenerMethods(
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
