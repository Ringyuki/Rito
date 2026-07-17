import {
  createLayoutConfig,
  type LayoutConfig,
  type Page,
  type ReaderOptions,
  type Spread,
} from '../../reader';
import {
  createRitoCoreWasmReaderChapterMap,
  createRitoCoreWasmReaderManifestHrefMap,
  createRitoCoreWasmReaderPages,
  createRitoCoreWasmReaderSpreads,
} from './core-contracts';
import { hostFontMetricConfig } from './font-metrics';
import type { CoreLayoutConfig, BrowserReaderState } from './reader/types';

interface BrowserReaderLayoutViewCache {
  pagesRevision?: BrowserReaderState['revisionBundle']['revision'];
  pagesConfig?: LayoutConfig;
  pages?: readonly Page[];
  spreadsPages?: readonly Page[];
  spreadsNavigation?: BrowserReaderState['revisionBundle']['navigation'];
  spreads?: readonly Spread[];
  chapterMapNavigation?: BrowserReaderState['revisionBundle']['navigation'];
  chapterMap?: ReturnType<typeof createRitoCoreWasmReaderChapterMap>;
  manifestPublication?: BrowserReaderState['publication'];
  manifestHrefMap?: ReturnType<typeof createRitoCoreWasmReaderManifestHrefMap>;
}

const layoutViewCaches = new WeakMap<BrowserReaderState, BrowserReaderLayoutViewCache>();

export function resetBrowserReaderLayoutViewCache(state: BrowserReaderState): void {
  layoutViewCaches.delete(state);
}

export function makeBrowserReaderLayoutConfig(
  options: ReaderOptions,
  spreadMode: 'single' | 'double',
): LayoutConfig {
  return createLayoutConfig({
    width: options.width,
    height: options.height,
    margin: options.margin ?? 40,
    spread: spreadMode,
    spreadGap: options.spreadGap ?? 20,
    ...(options.paginationPolicy !== undefined
      ? { paginationPolicy: options.paginationPolicy }
      : {}),
  });
}

export function toCoreLayoutConfig(
  config: LayoutConfig,
  fontMetrics: BrowserReaderState['fontMetrics'],
): CoreLayoutConfig {
  return {
    ...config,
    textMeasurement: 'fontAware',
    ...hostFontMetricConfig(fontMetrics),
  };
}

export function applyLayoutOverrides(
  state: BrowserReaderState,
  config: LayoutConfig,
): LayoutConfig {
  return {
    ...config,
    ...(state.fontSizeOverride !== undefined ? { rootFontSize: state.fontSizeOverride } : {}),
    ...(state.lineHeightOverride !== undefined
      ? { lineHeightOverride: state.lineHeightOverride }
      : {}),
    lineHeightForce: state.lineHeightForce,
    ...(state.fontFamilyOverride !== undefined
      ? { fontFamilyOverride: state.fontFamilyOverride }
      : {}),
    fontFamilyForce: state.fontFamilyForce,
  };
}

export function browserReaderPages(state: BrowserReaderState): readonly Page[] {
  const cache = layoutViewCache(state);
  const revision = state.revisionBundle.revision;
  const config = state.config;
  if (
    cache.pages === undefined ||
    cache.pagesRevision !== revision ||
    cache.pagesConfig !== config
  ) {
    cache.pagesRevision = revision;
    cache.pagesConfig = config;
    cache.pages = createRitoCoreWasmReaderPages(revision.pageCount, config);
  }
  return cache.pages;
}

export function browserReaderSpreads(state: BrowserReaderState): readonly Spread[] {
  const cache = layoutViewCache(state);
  const pages = browserReaderPages(state);
  const navigation = state.revisionBundle.navigation;
  if (
    cache.spreads === undefined ||
    cache.spreadsPages !== pages ||
    cache.spreadsNavigation !== navigation
  ) {
    cache.spreadsPages = pages;
    cache.spreadsNavigation = navigation;
    cache.spreads = createRitoCoreWasmReaderSpreads(pages, navigation);
  }
  return cache.spreads;
}

export function browserReaderChapterMap(
  state: BrowserReaderState,
): ReturnType<typeof createRitoCoreWasmReaderChapterMap> {
  const cache = layoutViewCache(state);
  const navigation = state.revisionBundle.navigation;
  if (cache.chapterMap === undefined || cache.chapterMapNavigation !== navigation) {
    cache.chapterMapNavigation = navigation;
    cache.chapterMap = createRitoCoreWasmReaderChapterMap(navigation);
  }
  return cache.chapterMap;
}

export function browserReaderManifestHrefMap(
  state: BrowserReaderState,
): ReturnType<typeof createRitoCoreWasmReaderManifestHrefMap> {
  const cache = layoutViewCache(state);
  const publication = state.publication;
  if (cache.manifestHrefMap === undefined || cache.manifestPublication !== publication) {
    cache.manifestPublication = publication;
    cache.manifestHrefMap = createRitoCoreWasmReaderManifestHrefMap(publication);
  }
  return cache.manifestHrefMap;
}

function layoutViewCache(state: BrowserReaderState): BrowserReaderLayoutViewCache {
  const cached = layoutViewCaches.get(state);
  if (cached) return cached;
  const created: BrowserReaderLayoutViewCache = {};
  layoutViewCaches.set(state, created);
  return created;
}
