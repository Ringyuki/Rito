import type { Reader, ReaderOptions } from '../../reader';
import type { EpubDocument } from '../ts-core/runtime/types';
// FootnoteEntry is a stable public type (text + html, no parser AST).
import { loadEpub } from '../ts-core/runtime/load-epub';
import { disposeAssets } from '../ts-core/render/web';
import {
  buildReaderMethods,
  createReaderLayoutControls,
  createReaderNavigation,
  defineReaderAccessors,
  initReaderState,
  type ReaderState,
} from './helpers';
export type { Reader, ReaderOptions, ReaderThemeOptions } from '../../reader';

/**
 * Load an EPUB and return a ready-to-render {@link Reader}.
 *
 * Parses the EPUB, registers fonts, decodes images, paginates, and builds spreads.
 *
 * @example
 * ```ts
 * import { createReader } from './reference';
 *
 * const reader = await createReader(epubData, canvas, {
 *   width: 800, height: 600, margin: 40, spread: 'double',
 * });
 *
 * reader.renderSpread(0);
 * console.log(`${reader.totalSpreads} spreads, ${reader.toc.length} TOC entries`);
 *
 * reader.dispose();
 * ```
 */
export async function createReader(
  data: ArrayBuffer,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: ReaderOptions,
): Promise<Reader> {
  const doc: EpubDocument = loadEpub(data);
  let state: ReaderState | undefined;
  try {
    state = await initReaderState(doc, canvas, options);
    return buildReader(doc, canvas, options, state);
  } catch (error: unknown) {
    if (state) disposeAssets(state.assets);
    doc.close();
    throw error;
  }
}

function buildReader(
  doc: EpubDocument,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: ReaderOptions,
  state: ReaderState,
): Reader {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const manifestHrefs = new Map(doc.packageDocument.manifest.map((m) => [m.id, m.href] as const));
  const layoutControls = createReaderLayoutControls(state, doc, options);
  const navigation = createReaderNavigation(doc, state, manifestHrefs);

  return Object.assign(
    defineReaderAccessors(state, doc, manifestHrefs),
    buildReaderMethods(state, doc, canvas, ctx, layoutControls),
    layoutControls,
    navigation,
  ) as Reader;
}
