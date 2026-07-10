import type { LayoutBlock, LineBox, Page, Rect } from '../../layout/core/types';
import { offsetBounds } from './bounds';
import {
  createPageVisualGeometry,
  enterBlockVisualGeometry,
  resolveVisualRect,
  type VisualGeometry,
} from './visual-geometry';

/** ARIA-compatible semantic roles derived from HTML tags. */
export type SemanticRole =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'listitem'
  | 'image'
  | 'link'
  | 'blockquote'
  | 'table'
  | 'generic';

/** A node in the semantic tree for accessibility consumers. */
export interface SemanticNode {
  readonly role: SemanticRole;
  readonly level?: number;
  readonly text?: string;
  readonly alt?: string;
  readonly href?: string;
  readonly bounds: Rect;
  readonly children: readonly SemanticNode[];
}

/** Build a transformed and clipped semantic tree from a page's layout data. */
export function buildSemanticTree(page: Page): readonly SemanticNode[] {
  const visual = createPageVisualGeometry();
  const nodes: SemanticNode[] = [];
  for (const block of page.content) {
    const node = blockToSemantic(block, 0, 0, visual);
    if (node) nodes.push(node);
  }
  return nodes;
}

function blockToSemantic(
  block: LayoutBlock,
  offsetX: number,
  offsetY: number,
  parentVisual: VisualGeometry,
): SemanticNode | undefined {
  const blockX = offsetX + block.bounds.x;
  const blockY = offsetY + block.bounds.y;
  const visual = enterBlockVisualGeometry(block, blockX, blockY, parentVisual);
  const bounds = resolveVisualRect(offsetBounds(block.bounds, offsetX, offsetY), visual);
  if (!bounds) return undefined;

  const children: SemanticNode[] = [];
  let text = '';
  for (const child of block.children) {
    if (child.type === 'line-box') {
      text += extractLineText(child);
      children.push(...extractLineSemantics(child, blockX, blockY, visual));
    } else if (child.type === 'image') {
      const image = imageNode(
        offsetBounds(child.bounds, blockX, blockY),
        visual,
        child.alt,
        child.href,
      );
      if (image) children.push(image);
    } else if (child.type === 'layout-block') {
      const nested = blockToSemantic(child, blockX, blockY, visual);
      if (nested) children.push(nested);
    }
  }

  const role = tagToRole(block.semanticTag);
  const level = parseHeadingLevel(block.semanticTag);
  const trimmedText = text.trim();
  return {
    role,
    bounds,
    children,
    ...(level !== undefined ? { level } : {}),
    ...(trimmedText ? { text: trimmedText } : {}),
  };
}

function extractLineText(lineBox: LineBox): string {
  let text = '';
  for (const run of lineBox.runs) {
    if (run.type === 'text-run') text += run.text;
  }
  return text;
}

function extractLineSemantics(
  lineBox: LineBox,
  offsetX: number,
  offsetY: number,
  visual: VisualGeometry,
): SemanticNode[] {
  const nodes: SemanticNode[] = [];
  const lineX = offsetX + lineBox.bounds.x;
  const lineY = offsetY + lineBox.bounds.y;
  for (const run of lineBox.runs) {
    if (run.type === 'ruby-annotation') continue;
    const sourceBounds = offsetBounds(run.bounds, lineX, lineY);
    if (run.type === 'text-run') {
      const bounds = resolveVisualRect(sourceBounds, visual);
      if (bounds) {
        nodes.push(
          run.href
            ? { role: 'link', href: run.href, text: run.text, bounds, children: [] }
            : { role: 'generic', text: run.text, bounds, children: [] },
        );
      }
      continue;
    }

    if (run.imageSrc) {
      const image = imageNode(sourceBounds, visual, run.alt, run.href);
      if (image) nodes.push(image);
    } else if (run.href) {
      const bounds = resolveVisualRect(sourceBounds, visual);
      if (bounds) nodes.push({ role: 'link', href: run.href, bounds, children: [] });
    }
  }
  return nodes;
}

function imageNode(
  sourceBounds: Rect,
  visual: VisualGeometry,
  alt: string | undefined,
  href: string | undefined,
): SemanticNode | undefined {
  const bounds = resolveVisualRect(sourceBounds, visual);
  if (!bounds) return undefined;
  const image: SemanticNode = {
    role: 'image',
    bounds,
    children: [],
    ...(alt ? { alt } : {}),
  };
  if (!href) return image;
  return { role: 'link', href, bounds, children: [image] };
}

const TAG_ROLE_MAP: Record<string, SemanticRole> = {
  p: 'paragraph',
  div: 'generic',
  blockquote: 'blockquote',
  ul: 'list',
  ol: 'list',
  li: 'listitem',
  table: 'table',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
};

function tagToRole(tag?: string): SemanticRole {
  if (!tag) return 'generic';
  return TAG_ROLE_MAP[tag] ?? 'generic';
}

function parseHeadingLevel(tag?: string): number | undefined {
  if (!tag || tag.length !== 2 || tag[0] !== 'h') return undefined;
  const level = Number.parseInt(tag[1] ?? '', 10);
  return level >= 1 && level <= 6 ? level : undefined;
}
