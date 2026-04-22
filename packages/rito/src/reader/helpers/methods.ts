import type { LayoutConfig, Spread } from '../../layout/core/types';
import type { TextMeasurer } from '../../layout/text/text-measurer';
import { disposeAssets } from '../../render/assets';
import { getSpreadDimensions } from '../../render/spread';
import type { EpubDocument } from '../../runtime/types';
import { buildHrefResolver } from '../../utils/resolve-href';
import type { createReaderLayoutControls } from './layout-controls';
import { renderSpreadToCanvas, renderSpreadToContext } from './rendering';
import type { ReaderState } from './types';

type ReaderLayoutControls = ReturnType<typeof createReaderLayoutControls>;
type ReaderMethods = ReturnType<typeof buildRenderMethods> &
  ReturnType<typeof buildDisplayMethods> &
  ReturnType<typeof buildResourceMethods> & {
    readonly measurer: TextMeasurer;
  } & ReturnType<typeof buildTypographyMethods> &
  ReturnType<typeof buildLifecycleMethods>;

export function buildReaderMethods(
  state: ReaderState,
  doc: EpubDocument,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  ctx: CanvasRenderingContext2D,
  layoutControls: ReaderLayoutControls,
): ReaderMethods {
  return {
    ...buildRenderMethods(state, canvas, ctx),
    ...buildDisplayMethods(state),
    ...buildResourceMethods(state, doc),
    measurer: state.assets.measurer as TextMeasurer,
    ...buildTypographyMethods(state, layoutControls),
    ...buildLifecycleMethods(state, doc),
  };
}

function buildRenderMethods(
  state: ReaderState,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  ctx: CanvasRenderingContext2D,
) {
  return {
    renderSpread: (index: number, scale = 1): void => {
      renderSpreadToCanvas(state, canvas, ctx, index, scale);
    },
    renderSpreadTo: (
      index: number,
      targetCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    ): void => {
      renderSpreadToContext(state, targetCtx, index);
    },
    notifyActiveSpread: (index: number): void => {
      const spread = state.spreads[index];
      if (!spread) return;
      for (const cb of state.spreadRenderedListeners) cb(index, spread);
    },
  };
}

function buildDisplayMethods(state: ReaderState) {
  return {
    setTheme(opts: { backgroundColor?: string; foregroundColor?: string }): void {
      if (opts.backgroundColor !== undefined) state.bgColor = opts.backgroundColor;
      if (opts.foregroundColor !== undefined) state.fgColor = opts.foregroundColor;
    },
    getCanvasSize: (scale = 1) => {
      const effectiveRatio = scale * state.dpr;
      const dims = getSpreadDimensions(state.config, effectiveRatio);
      return { width: dims.width / state.dpr, height: dims.height / state.dpr };
    },
    getLayoutGeometry: (): Readonly<LayoutConfig> => state.config,
  };
}

function buildResourceMethods(state: ReaderState, doc: EpubDocument) {
  return {
    getChapterTextIndices: () => state.resources.chapterTextIndices,
    getFootnotes: () => state.resources.footnoteMap,
    getImageBlobUrl: createImageBlobUrlResolver(doc),
  };
}

function createImageBlobUrlResolver(doc: EpubDocument): (src: string) => string | undefined {
  const resolve = buildHrefResolver(doc.images);
  return (src: string): string | undefined => {
    const bytes = resolve(src);
    if (!bytes) return undefined;
    const blob = new Blob([bytes.buffer as ArrayBuffer]);
    return URL.createObjectURL(blob);
  };
}

function buildTypographyMethods(state: ReaderState, layoutControls: ReaderLayoutControls) {
  return {
    setTypography(opts: {
      fontSize?: number | null;
      lineHeight?: number | null;
      lineHeightForce?: boolean;
      fontFamily?: string | null;
      fontFamilyForce?: boolean;
    }): boolean {
      applyTypographyOptions(state, opts);
      return layoutControls.updateLayout(
        state.config.viewportWidth,
        state.config.viewportHeight,
        state.spreadMode,
      );
    },
  };
}

function applyTypographyOptions(
  state: ReaderState,
  opts: {
    fontSize?: number | null;
    lineHeight?: number | null;
    lineHeightForce?: boolean;
    fontFamily?: string | null;
    fontFamilyForce?: boolean;
  },
): void {
  if (opts.fontSize !== undefined) state.fontSizeOverride = opts.fontSize ?? undefined;
  if (opts.lineHeight !== undefined) state.lineHeightOverride = opts.lineHeight ?? undefined;
  if (opts.lineHeightForce !== undefined) state.lineHeightForce = opts.lineHeightForce;
  if (opts.fontFamily !== undefined) state.fontFamilyOverride = opts.fontFamily ?? undefined;
  if (opts.fontFamilyForce !== undefined) state.fontFamilyForce = opts.fontFamilyForce;
}

function buildLifecycleMethods(state: ReaderState, doc: EpubDocument) {
  return {
    onSpreadRendered(cb: (spreadIndex: number, spread: Spread) => void): () => void {
      state.spreadRenderedListeners.add(cb);
      return () => state.spreadRenderedListeners.delete(cb);
    },
    dispose(): void {
      state.spreadRenderedListeners.clear();
      disposeAssets(state.assets);
      doc.close();
    },
  };
}
