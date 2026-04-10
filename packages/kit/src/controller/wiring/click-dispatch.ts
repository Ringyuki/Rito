import type { Reader } from 'rito';
import type { HitEntry, LinkRegion } from 'rito/advanced';
import { findAnnotationAtPos } from './annotation';
import { findLinkAtPos } from './link';
import type { WiringDeps } from '../core/wiring-deps';

/**
 * Unified click target resolution and event dispatch.
 *
 * Priority order:
 * 1. Annotation (existing highlight/note)
 * 2. Footnote link (href matches reader.getFootnotes())
 * 3. Regular link (internal or external)
 * 4. Image (standalone, not wrapped in a link)
 *
 * Both desktop single-click and touch tap route through this function.
 */
export function dispatchClick(pos: { x: number; y: number }, deps: WiringDeps): void {
  // 1. Annotation click (highest priority)
  const ann = findAnnotationAtPos(pos, deps);
  if (ann) {
    deps.emitter.emit('annotationClick', { annotation: ann });
    return;
  }

  // 2-3. Link click (footnote or regular) — check link map first, then hit map href fallback
  const link = findLinkAtPos(pos, deps.coordState);
  if (link) {
    dispatchLinkClick(link, pos, deps);
    return;
  }

  // Fallback: hit map entry with href (e.g. <a> wrapping a block-level <img>)
  const hrefHit = findHrefAtPos(pos, deps);
  if (hrefHit) {
    dispatchLinkClick({ bounds: hrefHit.bounds, href: hrefHit.href, text: '' }, pos, deps);
    return;
  }

  // 4. Image click (standalone — not wrapped in a link)
  const imageHit = findImageAtPos(pos, deps);
  if (imageHit) dispatchImageClick(pos, imageHit, deps);
}

function dispatchImageClick(pos: { x: number; y: number }, hit: HitEntry, deps: WiringDeps): void {
  const { coordState, canvas } = deps;
  const mapper = coordState.mapper;
  if (!mapper) return;
  const resolved = mapper.spreadContentToPage(pos.x, pos.y);
  if (!resolved) return;

  const canvasRect = canvas.getBoundingClientRect();
  const screenBounds = mapper.pageContentToScreen(resolved.pageIndex, hit.bounds, canvasRect);

  // Revoke previous blob URL before creating a new one
  if (coordState.activeImageBlobUrl) {
    URL.revokeObjectURL(coordState.activeImageBlobUrl);
    coordState.activeImageBlobUrl = null;
  }
  const blobUrl = hit.imageSrc ? deps.reader.getImageBlobUrl(hit.imageSrc) : undefined;
  if (blobUrl) coordState.activeImageBlobUrl = blobUrl;

  deps.emitter.emit('imageClick', {
    src: hit.imageSrc ?? '',
    alt: hit.imageAlt ?? '',
    blobUrl,
    screenBounds,
  });
}

function dispatchLinkClick(
  region: LinkRegion,
  pos: { x: number; y: number },
  deps: WiringDeps,
): void {
  const { reader, emitter } = deps;
  const href = region.href;

  // Check if this link targets a footnote (scoped by current chapter)
  const currentChapterHref = resolveCurrentChapterHref(pos, deps);
  const footnoteKey = resolveFootnoteKey(href, currentChapterHref, reader);
  if (footnoteKey) {
    const entry = reader.getFootnotes().get(footnoteKey);
    if (entry) {
      emitter.emit('footnoteClick', { id: footnoteKey, href, content: entry });
      return;
    }
  }

  // External link
  if (href.startsWith('http://') || href.startsWith('https://')) {
    const navigate = () => window.open(href, '_blank', 'noopener');
    emitter.emit('linkClick', { href, text: region.text, type: 'external', navigate });
    return;
  }

  // Internal link — resolve target page and TOC label
  const syntheticEntry = { label: '', href, children: [] as never[] };
  const targetPage = reader.findPage(syntheticEntry);
  const navigate = (): void => {
    if (targetPage === undefined) return;
    const spreadIdx = reader.findSpread(targetPage);
    if (spreadIdx === undefined) return;
    deps.goToSpread(spreadIdx);
  };
  const resolvedLabel =
    targetPage !== undefined ? reader.findActiveTocEntry(targetPage)?.label : undefined;

  emitter.emit('linkClick', {
    href,
    text: region.text,
    type: 'internal',
    resolvedLabel,
    navigate,
  });
}

/**
 * Resolve the manifest href of the chapter currently displayed at the click position.
 * Used to scope same-document footnote lookup.
 */
function resolveCurrentChapterHref(
  pos: { x: number; y: number },
  deps: WiringDeps,
): string | undefined {
  const { coordState, reader } = deps;
  if (!coordState.mapper) return undefined;

  const resolved = coordState.mapper.spreadContentToPage(pos.x, pos.y);
  if (!resolved) return undefined;

  // Find which chapter contains this page
  for (const [idref, range] of reader.chapterMap) {
    if (resolved.pageIndex >= range.startPage && resolved.pageIndex <= range.endPage) {
      return reader.manifestHrefMap.get(idref);
    }
  }
  return undefined;
}

/**
 * Resolve a link href to a footnoteMap key (`manifestHref#fragment`).
 *
 * Same-document `#id` → `currentChapterHref#id` (exact match).
 * Cross-document `file.xhtml#id` → try exact key match.
 * No fallback to first-match — prevents cross-chapter ID collision.
 */
function resolveFootnoteKey(
  href: string,
  currentChapterHref: string | undefined,
  reader: Reader,
): string | null {
  const footnotes = reader.getFootnotes();
  if (footnotes.size === 0) return null;

  const hashIdx = href.indexOf('#');
  if (hashIdx < 0) return null;
  const fragment = href.slice(hashIdx + 1);
  if (!fragment) return null;

  if (hashIdx === 0) {
    // Same-document: #id → currentChapterHref#id
    if (!currentChapterHref) return null;
    const key = `${currentChapterHref}#${fragment}`;
    return footnotes.has(key) ? key : null;
  }

  // Cross-document: try exact match on full href
  if (footnotes.has(href)) return href;

  // Try matching the file part against manifest hrefs
  const filePart = href.slice(0, hashIdx);
  for (const key of footnotes.keys()) {
    const keyHash = key.indexOf('#');
    if (keyHash < 0) continue;
    const keyFile = key.slice(0, keyHash);
    const keyFrag = key.slice(keyHash + 1);
    if (keyFrag !== fragment) continue;
    if (keyFile === filePart || keyFile.endsWith(`/${filePart}`)) return key;
  }
  return null;
}

/**
 * Find a hit entry with an href at the given position.
 * Covers cases where link-map misses (e.g. block-level <img> inside <a>)
 * but the hit-map entry still carries the href from the parent anchor.
 */
function findHrefAtPos(
  pos: { x: number; y: number },
  deps: WiringDeps,
): (HitEntry & { href: string }) | undefined {
  const { coordState } = deps;
  if (!coordState.mapper) return undefined;
  const resolved = coordState.mapper.spreadContentToPage(pos.x, pos.y);
  if (!resolved) return undefined;
  const hm = coordState.hitMaps.get(resolved.pageIndex);
  if (!hm) return undefined;
  const { x, y } = resolved;
  for (const entry of hm.entries) {
    if (!entry.href) continue;
    const b = entry.bounds;
    if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) {
      return entry as HitEntry & { href: string };
    }
  }
  return undefined;
}

/**
 * Strict bounds-check for an image at a spread-content position.
 * Unlike hitTest() which falls back to the nearest entry on the same line,
 * this only matches when the point is strictly inside the image bounds.
 */
function findImageAtPos(pos: { x: number; y: number }, deps: WiringDeps): HitEntry | undefined {
  const { coordState } = deps;
  if (!coordState.mapper) return undefined;
  const resolved = coordState.mapper.spreadContentToPage(pos.x, pos.y);
  if (!resolved) return undefined;
  const hm = coordState.hitMaps.get(resolved.pageIndex);
  if (!hm) return undefined;
  const { x, y } = resolved;
  for (const entry of hm.entries) {
    if (!entry.imageSrc || entry.href) continue; // skip images wrapped in links
    const b = entry.bounds;
    if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) return entry;
  }
  return undefined;
}
