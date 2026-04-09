import type { Reader } from 'rito';
import type { LinkRegion } from 'rito/advanced';
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
 * 4. Image (requires HitEntry imageSrc enhancement — Phase 8 Step 5)
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

  // 2-3. Link click (footnote or regular)
  const link = findLinkAtPos(pos, deps.coordState);
  if (link) {
    dispatchLinkClick(link, pos, deps);
    return;
  }

  // 4. Image click — Phase 8 Step 5 (needs HitEntry imageSrc field)
}

function dispatchLinkClick(
  region: LinkRegion,
  pos: { x: number; y: number },
  deps: WiringDeps,
): void {
  const { reader, emitter, setCurrentSpread } = deps;
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
    emitter.emit('linkClick', {
      href,
      text: region.text,
      type: 'external',
      navigate: () => {
        window.open(href, '_blank', 'noopener');
      },
    });
    return;
  }

  // Internal link
  const navigate = (): void => {
    const page = reader.findPage({ label: '', href, children: [] });
    if (page === undefined) return;
    const spreadIdx = reader.findSpread(page);
    if (spreadIdx === undefined) return;
    setCurrentSpread(spreadIdx);
    const spread = reader.spreads[spreadIdx];
    if (spread) emitter.emit('spreadChange', { spreadIndex: spreadIdx, spread });
    reader.renderSpread(spreadIdx);
  };

  emitter.emit('linkClick', { href, text: region.text, type: 'internal', navigate });
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
