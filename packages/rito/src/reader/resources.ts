import type { ChapterTextIndex } from '../interaction/anchors/chapter-text-index';
import type { LayoutConfig, Page } from '../layout/core/types';
import { disposeAssets, loadAssets, type LoadedAssets } from '../render/web/resources';
import type { FootnoteEntry } from '../runtime/footnote-extractor';
import { paginateWithMeta } from '../runtime/paginate';
import type { ChapterRange, EpubDocument } from '../runtime/types';
import type { Logger } from '../utils/logger';

const resourceDisposer = Symbol('rito.resourceDisposer');
const disposedResources = new WeakSet();

/** Paginated content and decoded images needed by the Web Reader. */
export interface Resources {
  readonly pages: readonly Page[];
  readonly images: ReadonlyMap<string, ImageBitmap>;
  readonly chapterMap: ReadonlyMap<string, ChapterRange>;
  readonly anchorMap: ReadonlyMap<string, number>;
  readonly chapterAnchorMap?: ReadonlyMap<string, ReadonlyMap<string, number>>;
  readonly chapterTextIndices: ReadonlyMap<string, ChapterTextIndex>;
  readonly footnoteMap: ReadonlyMap<string, FootnoteEntry>;
}

/** Run pagination using pre-loaded Web assets. */
export function paginateWithAssets(
  doc: EpubDocument,
  config: LayoutConfig,
  assets: LoadedAssets,
  lineBreaking?: 'greedy' | 'optimal',
  logger?: Logger,
): Omit<Resources, 'images'> {
  const result = paginateWithMeta(
    doc,
    config,
    assets.measurer,
    assets.images,
    lineBreaking,
    logger,
  );
  return {
    pages: result.pages,
    chapterMap: result.chapterMap,
    anchorMap: result.anchorMap,
    ...(result.chapterAnchorMap ? { chapterAnchorMap: result.chapterAnchorMap } : {}),
    chapterTextIndices: result.chapterTextIndices,
    footnoteMap: result.footnoteMap,
  };
}

/** Load Web assets and paginate the full spine. */
export async function prepare(
  doc: EpubDocument,
  config: LayoutConfig,
  canvas: HTMLCanvasElement | OffscreenCanvas,
): Promise<Resources> {
  const assets = await loadAssets(doc, canvas);
  try {
    const pagination = paginateWithAssets(doc, config, assets);
    const resources: Resources = { ...pagination, images: assets.images };
    Object.defineProperty(resources, resourceDisposer, {
      value: () => {
        disposeAssets(assets);
      },
    });
    return resources;
  } catch (error: unknown) {
    disposeAssets(assets);
    throw error;
  }
}

/** Release images and fonts owned by a {@link Resources} object. */
export function disposeResources(resources: Resources): void {
  if (disposedResources.has(resources)) return;
  disposedResources.add(resources);
  const disposer = (resources as ResourcesWithDisposer)[resourceDisposer];
  if (disposer) {
    disposer();
    return;
  }
  for (const bitmap of resources.images.values()) bitmap.close();
}

interface ResourcesWithDisposer extends Resources {
  readonly [resourceDisposer]?: () => void;
}
