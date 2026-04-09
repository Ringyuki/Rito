import type { DocumentNode, ElementAttributes } from '../parser/xhtml/types';
import { buildHrefResolver } from '../utils/resolve-href';

/**
 * Canonical and deprecated epub:type values for footnote semantics.
 * Per W3C EPUB Structural Semantics Vocabulary 1.1.
 */
type FootnoteKind = 'footnote' | 'endnote' | 'rearnote' | 'note';

const FOOTNOTE_KINDS: ReadonlyMap<string, FootnoteKind> = new Map([
  ['footnote', 'footnote'],
  ['endnote', 'endnote'],
  ['rearnote', 'rearnote'],
  ['note', 'note'],
]);

/** Structured footnote entry with stable public representations (no parser AST). */
export interface FootnoteEntry {
  readonly kind: FootnoteKind;
  /** Plain-text content (for search / quick display). */
  readonly text: string;
  /** Serialized HTML fragment preserving structure, attributes, and links. */
  readonly html: string;
}

/**
 * Mapping from spine idref to manifest href for cross-document reference resolution.
 * Built from the EPUB package document manifest + spine.
 */
export type ManifestHrefMap = ReadonlyMap<string, string>;

// ── Public API ──────────────────────────────────────────────────────

/**
 * Extract footnotes from all chapters at once (full-book two-phase approach).
 *
 * Keys are unified as `manifestHref#fragment` to prevent cross-chapter ID
 * collision and enable cross-document noteref resolution.
 *
 * @param chapters Map from spine idref to parsed nodes
 * @param hrefMap Mapping from spine idref to manifest href
 */
export function extractAllFootnotes(
  chapters: ReadonlyMap<string, readonly DocumentNode[]>,
  hrefMap: ManifestHrefMap,
): {
  filteredChapters: Map<string, readonly DocumentNode[]>;
  footnotes: Map<string, FootnoteEntry>;
} {
  // Build a resolver for cross-document href matching (reuses resolve-href.ts logic)
  const hrefSet = new Map<string, string>();
  for (const href of hrefMap.values()) hrefSet.set(href, href);
  const fileResolver = buildHrefResolver(hrefSet);

  // Phase 1: collect ALL noteref targets across all chapters
  const targets = new Set<string>();
  for (const [idref, nodes] of chapters) {
    const chapterHref = hrefMap.get(idref) ?? idref;
    collectNoterefTargets(nodes, chapterHref, fileResolver, targets);
  }

  // Phase 2: extract referenced footnotes
  const footnotes = new Map<string, FootnoteEntry>();
  const filteredChapters = new Map<string, readonly DocumentNode[]>();
  for (const [idref, nodes] of chapters) {
    const chapterHref = hrefMap.get(idref) ?? idref;
    filteredChapters.set(idref, removeFootnotes(nodes, chapterHref, targets, footnotes));
  }
  return { filteredChapters, footnotes };
}

/**
 * Extract footnotes from a single chapter (incremental path).
 * Only same-document noterefs are matched.
 */
export function extractChapterFootnotes(
  nodes: readonly DocumentNode[],
  chapterHref: string,
): {
  filtered: readonly DocumentNode[];
  footnotes: Map<string, FootnoteEntry>;
} {
  const targets = new Set<string>();
  // Incremental: no cross-doc resolver, same-doc noterefs only
  const noopResolver: FileResolver = () => undefined;
  collectNoterefTargets(nodes, chapterHref, noopResolver, targets);
  if (targets.size === 0) return { filtered: nodes, footnotes: new Map() };
  const footnotes = new Map<string, FootnoteEntry>();
  const filtered = removeFootnotes(nodes, chapterHref, targets, footnotes);
  return { filtered, footnotes };
}

/**
 * Build a mapping from spine idref to manifest href.
 */
export function buildManifestHrefMap(
  manifest: ReadonlyArray<{ readonly id: string; readonly href: string }>,
  spine: ReadonlyArray<{ readonly idref: string }>,
): ManifestHrefMap {
  const byId = new Map<string, string>();
  for (const item of manifest) byId.set(item.id, item.href);
  const result = new Map<string, string>();
  for (const item of spine) {
    const href = byId.get(item.idref);
    if (href) result.set(item.idref, href);
  }
  return result;
}

// ── Phase 1: noteref target collection ──────────────────────────────

type FileResolver = (src: string) => string | undefined;

/**
 * Recursively scan for epub:type="noteref" and collect targets.
 *
 * Same-document refs (#id) → `currentChapterHref#id`
 * Cross-document refs (file.xhtml#id) → resolve via buildHrefResolver → `resolvedHref#id`
 */
function collectNoterefTargets(
  nodes: readonly DocumentNode[],
  chapterHref: string,
  fileResolver: FileResolver,
  targets: Set<string>,
): void {
  for (const node of nodes) {
    if (node.type === 'text') continue;
    if (isNoteref(node)) {
      const href = node.attributes?.href;
      if (href) {
        const resolved = resolveNoterefTarget(href, chapterHref, fileResolver);
        if (resolved) targets.add(resolved);
      }
    }
    if ('children' in node)
      collectNoterefTargets(node.children, chapterHref, fileResolver, targets);
  }
}

/**
 * Resolve a noteref href to a canonical `manifestHref#fragment` key.
 *
 * - `#id` → `currentChapterHref#id` (same-document)
 * - `file.xhtml#id` → resolve via buildHrefResolver → `resolvedHref#id`
 */
function resolveNoterefTarget(
  href: string,
  chapterHref: string,
  fileResolver: FileResolver,
): string | null {
  const hashIdx = href.indexOf('#');
  if (hashIdx < 0) return null;
  const fragment = href.slice(hashIdx + 1);
  if (!fragment) return null;

  if (hashIdx === 0) {
    return `${chapterHref}#${fragment}`;
  }

  // Cross-document: use the same resolution logic as image/font href matching
  const filePart = href.slice(0, hashIdx);
  const resolved = fileResolver(filePart);
  return resolved ? `${resolved}#${fragment}` : null;
}

function isNoteref(node: DocumentNode): boolean {
  if (node.type !== 'inline' && node.type !== 'block') return false;
  const epubType = node.attributes?.allAttributes?.get('epub:type');
  return epubType?.split(/\s+/).includes('noteref') === true;
}

// ── Phase 2: footnote removal ───────────────────────────────────────

function removeFootnotes(
  nodes: readonly DocumentNode[],
  chapterHref: string,
  targets: Set<string>,
  footnotes: Map<string, FootnoteEntry>,
): readonly DocumentNode[] {
  let changed = false;
  const result: DocumentNode[] = [];

  for (const node of nodes) {
    const kind = getFootnoteKind(node);
    if (kind) {
      const id = (node as { attributes?: { id?: string } }).attributes?.id;
      const key = id ? `${chapterHref}#${id}` : null;
      if (key && targets.has(key)) {
        const children = 'children' in node ? node.children : [];
        footnotes.set(key, { kind, text: collectText(children), html: serializeHtml(children) });
        changed = true;
        continue;
      }
    }

    if ('children' in node) {
      const newChildren = removeFootnotes(node.children, chapterHref, targets, footnotes);
      if (newChildren !== node.children) {
        changed = true;
        result.push({ ...node, children: newChildren } as DocumentNode);
        continue;
      }
    }
    result.push(node);
  }
  return changed ? result : nodes;
}

function getFootnoteKind(node: DocumentNode): FootnoteKind | null {
  if (node.type !== 'block') return null;
  const epubType = node.attributes?.allAttributes?.get('epub:type');
  if (!epubType) return null;
  for (const token of epubType.split(/\s+/)) {
    const kind = FOOTNOTE_KINDS.get(token);
    if (kind) return kind;
  }
  return null;
}

// ── Serialization ───────────────────────────────────────────────────

/**
 * Collect plain text from nodes.
 * Block boundaries insert a space; inline elements concatenate directly.
 */
function collectText(nodes: readonly DocumentNode[]): string {
  let result = '';
  for (const node of nodes) {
    if (node.type === 'text') {
      result += node.content;
    } else if (node.type === 'block') {
      const nested = collectText(node.children).trim();
      if (nested) {
        if (result.length > 0 && !result.endsWith(' ')) result += ' ';
        result += nested;
      }
    } else if ('children' in node) {
      // Inline elements (em, a, span, etc.): no space boundary
      result += collectText(node.children);
    }
  }
  return result.trim();
}

/** Serialize DocumentNode[] to HTML, preserving tag names AND attributes. */
function serializeHtml(nodes: readonly DocumentNode[]): string {
  const parts: string[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      parts.push(escapeHtml(node.content));
    } else if (node.type === 'image') {
      parts.push(`<img${serializeAttrs(node.attributes)}>`);
    } else {
      const tag = node.tag;
      const attrs = serializeAttrs(node.attributes);
      parts.push(`<${tag}${attrs}>${serializeHtml(node.children)}</${tag}>`);
    }
  }
  return parts.join('');
}

/** Serialize all element attributes from allAttributes map. */
function serializeAttrs(attrs: ElementAttributes | undefined): string {
  if (!attrs?.allAttributes || attrs.allAttributes.size === 0) return '';
  const parts: string[] = [];
  for (const [name, value] of attrs.allAttributes) {
    parts.push(` ${name}="${escapeAttr(value)}"`);
  }
  return parts.join('');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
