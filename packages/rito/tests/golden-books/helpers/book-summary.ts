import type { EpubDocument, PaginationResult } from '../../../src/reference/ts-core/runtime/types';
import type { SpineItem, TocEntry } from '../../../src/reference/ts-core/parser/epub/types';
import type { BookFixture } from './book-manifest';
import { hashJson, toJsonValue, type JsonValue } from './canonicalize';
import type { GoldenBookConfig } from './golden-configs';
import {
  countPage,
  summarizePageDetail,
  summarizePageDigest,
  type PageCounts,
} from './page-summary';

const SAMPLE_PAGE_LIMIT = 40;

export function summarizeGoldenBook(
  book: BookFixture,
  byteLength: number,
  document: EpubDocument,
  result: PaginationResult,
  config: GoldenBookConfig,
): JsonValue {
  const pageDetails = result.pages.map((page) => summarizePageDetail(page));
  return {
    schemaVersion: 1,
    book: summarizeBookIdentity(book, byteLength),
    config: summarizeConfig(config),
    package: summarizePackage(document),
    pagination: summarizePagination(result, pageDetails),
    chapters: summarizeChapters(document, result),
    pages: pageDetails.map((detail) => summarizePageDigest(detail)),
    samples: chooseSamplePageIndices(result.pages.length, result).map((index) =>
      requirePageDetail(pageDetails, index),
    ),
  };
}

function summarizeBookIdentity(book: BookFixture, byteLength: number): JsonValue {
  return {
    id: book.id,
    path: book.path,
    byteLength,
  };
}

function summarizeConfig(config: GoldenBookConfig): JsonValue {
  return {
    id: config.id,
    lineBreaking: config.lineBreaking,
    layout: toJsonValue(config.layout),
  };
}

function summarizePackage(document: EpubDocument): JsonValue {
  const pkg = document.packageDocument;
  return {
    metadata: toJsonValue(pkg.metadata),
    manifestCount: pkg.manifest.length,
    spineCount: pkg.spine.length,
    tocCount: countTocEntries(document.toc),
    stylesheetCount: document.stylesheets.size,
    imageCount: document.images.size,
    fontCount: document.fonts.size,
  };
}

function summarizePagination(
  result: PaginationResult,
  pageDetails: readonly JsonValue[],
): JsonValue {
  const totals = result.pages.reduce((acc, page) => addCounts(acc, countPage(page)), emptyCounts());
  return {
    pageCount: result.pages.length,
    chapterCount: result.chapterMap.size,
    anchorCount: result.anchorMap.size,
    chapterTextIndexCount: result.chapterTextIndices.size,
    footnoteCount: result.footnoteMap.size,
    totals: toJsonValue(totals),
    fullDetailHash: hashJson(pageDetails),
  };
}

function summarizeChapters(document: EpubDocument, result: PaginationResult): JsonValue {
  const manifestById = new Map(document.packageDocument.manifest.map((item) => [item.id, item]));
  return document.packageDocument.spine.map((spine) =>
    summarizeChapter(spine, manifestById.get(spine.idref)?.href ?? '', document, result),
  );
}

function summarizeChapter(
  spine: SpineItem,
  href: string,
  document: EpubDocument,
  result: PaginationResult,
): JsonValue {
  const range = result.chapterMap.get(spine.idref);
  const xhtml = document.readChapter(spine.idref) ?? '';
  return {
    idref: spine.idref,
    href,
    linear: spine.linear,
    textLength: xhtml.length,
    textHash: hashText(xhtml),
    startPage: range?.startPage ?? null,
    endPage: range?.endPage ?? null,
    pageCount: range ? range.endPage - range.startPage + 1 : 0,
  };
}

function chooseSamplePageIndices(pageCount: number, result: PaginationResult): readonly number[] {
  const indices = new Set<number>();
  addRange(indices, 0, Math.min(3, pageCount));
  addRange(indices, Math.max(pageCount - 3, 0), pageCount);
  for (const range of result.chapterMap.values()) {
    indices.add(range.startPage);
    indices.add(range.endPage);
    if (indices.size >= SAMPLE_PAGE_LIMIT) break;
  }
  return [...indices]
    .filter((index) => index >= 0 && index < pageCount)
    .sort((left, right) => left - right)
    .slice(0, SAMPLE_PAGE_LIMIT);
}

function addRange(indices: Set<number>, start: number, end: number): void {
  for (let index = start; index < end; index++) indices.add(index);
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

function requirePageDetail(pageDetails: readonly JsonValue[], index: number): JsonValue {
  const detail = pageDetails[index];
  if (detail === undefined) throw new Error(`Missing page detail for index ${String(index)}`);
  return detail;
}

function countTocEntries(entries: readonly TocEntry[]): number {
  let total = 0;
  for (const entry of entries) {
    total += 1 + countTocEntries(entry.children);
  }
  return total;
}

function hashText(text: string): string {
  return hashJson(text);
}
