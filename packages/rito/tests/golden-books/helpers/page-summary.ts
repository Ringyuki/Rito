import type {
  HorizontalRule,
  ImageElement,
  InlineAtom,
  LayoutBlock,
  LineBox,
  Page,
  Rect,
  RubyAnnotation,
  TextRun,
} from '../../../src/layout/core/types';
import { hashJson, roundNumber, toJsonValue, type JsonValue } from './canonicalize';

export interface PageCounts {
  blocks: number;
  lines: number;
  textRuns: number;
  inlineAtoms: number;
  images: number;
  ruby: number;
  hrs: number;
}

interface TextEdges {
  readonly firstText: string;
  readonly lastText: string;
}

const TEXT_EDGE_LIMIT = 80;

export function summarizePageDigest(pageDetail: JsonValue): JsonValue {
  if (!isJsonObject(pageDetail)) return {};
  return {
    index: pageDetail['index'] ?? null,
    counts: pageDetail['counts'] ?? null,
    firstText: pageDetail['firstText'] ?? null,
    lastText: pageDetail['lastText'] ?? null,
    detailHash: hashJson(pageDetail),
  };
}

export function summarizePageDetail(page: Page): JsonValue {
  const counts = countPage(page);
  const edges = collectPageTextEdges(page);
  return {
    index: page.index,
    bounds: summarizeRect(page.bounds),
    paint: toJsonValue(page.paint),
    counts: toJsonValue(counts),
    firstText: edges.firstText,
    lastText: edges.lastText,
    blocks: page.content.map((block) => summarizeBlock(block)),
  };
}

function summarizeBlock(block: LayoutBlock): JsonValue {
  return {
    type: block.type,
    tag: block.semanticTag ?? null,
    anchorId: block.anchorId ?? null,
    bounds: summarizeRect(block.bounds),
    borderBox: toJsonValue(block.borderBox),
    paint: toJsonValue(block.paint),
    pageBreakBefore: block.pageBreakBefore ?? false,
    pageBreakAfter: block.pageBreakAfter ?? false,
    children: block.children.map((child) => summarizeLayoutChild(child)),
  };
}

function summarizeLayoutChild(
  child: LineBox | LayoutBlock | ImageElement | HorizontalRule,
): JsonValue {
  switch (child.type) {
    case 'line-box':
      return summarizeLineBox(child);
    case 'layout-block':
      return summarizeBlock(child);
    case 'image':
      return summarizeImage(child);
    case 'hr':
      return summarizeHr(child);
  }
}

function summarizeLineBox(line: LineBox): JsonValue {
  return {
    type: line.type,
    bounds: summarizeRect(line.bounds),
    runs: line.runs.map((run) => summarizeRun(run)),
  };
}

function summarizeRun(run: TextRun | InlineAtom | RubyAnnotation): JsonValue {
  if (run.type === 'text-run') return summarizeTextRun(run);
  if (run.type === 'inline-atom') return summarizeInlineAtom(run);
  return summarizeRuby(run);
}

function summarizeTextRun(run: TextRun): JsonValue {
  return {
    type: run.type,
    text: run.text,
    bounds: summarizeRect(run.bounds),
    href: run.href ?? null,
    inlineMarginRight: run.inlineMarginRight ?? null,
    lineHeightPx: run.lineHeightPx ?? null,
    paint: toJsonValue(run.paint),
  };
}

function summarizeInlineAtom(atom: InlineAtom): JsonValue {
  return {
    type: atom.type,
    bounds: summarizeRect(atom.bounds),
    imageSrc: atom.imageSrc ?? null,
    href: atom.href ?? null,
    alt: atom.alt ?? null,
    hasBlock: atom.block !== undefined,
  };
}

function summarizeRuby(ruby: RubyAnnotation): JsonValue {
  return {
    type: ruby.type,
    text: ruby.text,
    bounds: summarizeRect(ruby.bounds),
    paint: toJsonValue(ruby.paint),
  };
}

function summarizeImage(image: ImageElement): JsonValue {
  return {
    type: image.type,
    src: image.src,
    alt: image.alt ?? null,
    href: image.href ?? null,
    bounds: summarizeRect(image.bounds),
  };
}

function summarizeHr(hr: HorizontalRule): JsonValue {
  return {
    type: hr.type,
    bounds: summarizeRect(hr.bounds),
    paint: toJsonValue(hr.paint),
  };
}

function summarizeRect(rect: Rect): JsonValue {
  return {
    x: roundNumber(rect.x),
    y: roundNumber(rect.y),
    width: roundNumber(rect.width),
    height: roundNumber(rect.height),
  };
}

export function countPage(page: Page): PageCounts {
  return page.content.reduce((acc, block) => addCounts(acc, countBlock(block)), emptyCounts());
}

function countBlock(block: LayoutBlock): PageCounts {
  return block.children.reduce((acc, child) => addCounts(acc, countChild(child)), {
    ...emptyCounts(),
    blocks: 1,
  });
}

function countChild(child: LineBox | LayoutBlock | ImageElement | HorizontalRule): PageCounts {
  switch (child.type) {
    case 'line-box':
      return countLine(child);
    case 'layout-block':
      return countBlock(child);
    case 'image':
      return { ...emptyCounts(), images: 1 };
    case 'hr':
      return { ...emptyCounts(), hrs: 1 };
  }
}

function countLine(line: LineBox): PageCounts {
  return line.runs.reduce((acc, run) => addCounts(acc, countRun(run)), {
    ...emptyCounts(),
    lines: 1,
  });
}

function countRun(run: TextRun | InlineAtom | RubyAnnotation): PageCounts {
  if (run.type === 'text-run') return { ...emptyCounts(), textRuns: 1 };
  if (run.type === 'ruby-annotation') return { ...emptyCounts(), ruby: 1 };
  return { ...emptyCounts(), inlineAtoms: 1, images: run.imageSrc ? 1 : 0 };
}

function collectPageTextEdges(page: Page): TextEdges {
  const texts: string[] = [];
  for (const block of page.content) collectBlockText(block, texts);
  return {
    firstText: cropText(texts[0] ?? ''),
    lastText: cropText(texts[texts.length - 1] ?? ''),
  };
}

function collectBlockText(block: LayoutBlock, texts: string[]): void {
  for (const child of block.children) {
    if (child.type === 'line-box') collectLineText(child, texts);
    else if (child.type === 'layout-block') collectBlockText(child, texts);
  }
}

function collectLineText(line: LineBox, texts: string[]): void {
  for (const run of line.runs) {
    if (run.type === 'text-run' && run.text.trim().length > 0) texts.push(run.text);
  }
}

function cropText(text: string): string {
  return normalizeText(text).slice(0, TEXT_EDGE_LIMIT);
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function emptyCounts(): PageCounts {
  return { blocks: 0, lines: 0, textRuns: 0, inlineAtoms: 0, images: 0, ruby: 0, hrs: 0 };
}

function addCounts(left: PageCounts, right: PageCounts): PageCounts {
  return {
    blocks: left.blocks + right.blocks,
    lines: left.lines + right.lines,
    textRuns: left.textRuns + right.textRuns,
    inlineAtoms: left.inlineAtoms + right.inlineAtoms,
    images: left.images + right.images,
    ruby: left.ruby + right.ruby,
    hrs: left.hrs + right.hrs,
  };
}

function isJsonObject(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
