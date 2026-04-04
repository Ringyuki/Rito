import type { LayoutBlock, LineBox, Page, Rect } from '../layout/core/types';

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

/** Build a semantic tree from a page's layout data. */
export function buildSemanticTree(page: Page): readonly SemanticNode[] {
  return page.content
    .map((block) => blockToSemantic(block, 0, 0))
    .filter(Boolean) as SemanticNode[];
}

function blockToSemantic(
  block: LayoutBlock,
  offsetX: number,
  offsetY: number,
): SemanticNode | undefined {
  const bx = offsetX + block.bounds.x;
  const by = offsetY + block.bounds.y;
  const bounds = absoluteBounds(block.bounds, offsetX, offsetY);
  const role = tagToRole(block.semanticTag);
  const level = parseHeadingLevel(block.semanticTag);

  const children: SemanticNode[] = [];
  let text = '';

  for (const child of block.children) {
    if (child.type === 'line-box') {
      const lineText = extractLineText(child);
      const lineLinks = extractLineLinks(child, bx, by);
      text += lineText;
      children.push(...lineLinks);
    } else if (child.type === 'image') {
      const imgNode: SemanticNode = {
        role: 'image',
        bounds: absoluteBounds(child.bounds, bx, by),
        children: [],
      };
      children.push(child.alt ? { ...imgNode, alt: child.alt } : imgNode);
    } else if (child.type === 'layout-block') {
      const sub = blockToSemantic(child, bx, by);
      if (sub) children.push(sub);
    }
  }

  const node: SemanticNode = { role, bounds, children };
  if (level !== undefined) return { ...node, level, text: text.trim() };
  if (text) return { ...node, text: text.trim() };
  return node;
}

function extractLineText(lineBox: LineBox): string {
  let text = '';
  for (const run of lineBox.runs) {
    if (run.type === 'text-run') text += run.text;
  }
  return text;
}

function extractLineLinks(lineBox: LineBox, offsetX: number, offsetY: number): SemanticNode[] {
  const links: SemanticNode[] = [];
  const lx = offsetX + lineBox.bounds.x;
  const ly = offsetY + lineBox.bounds.y;

  for (const run of lineBox.runs) {
    if (run.type !== 'text-run' || !run.href) continue;
    links.push({
      role: 'link',
      href: run.href,
      text: run.text,
      bounds: absoluteBounds(run.bounds, lx, ly),
      children: [],
    });
  }
  return links;
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
  const n = parseInt(tag[1] ?? '', 10);
  return n >= 1 && n <= 6 ? n : undefined;
}

function absoluteBounds(b: Rect, offsetX: number, offsetY: number): Rect {
  return { x: offsetX + b.x, y: offsetY + b.y, width: b.width, height: b.height };
}
