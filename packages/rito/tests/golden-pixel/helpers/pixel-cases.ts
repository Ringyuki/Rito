import type { BookFixture } from '../../golden-books/helpers/book-manifest';
import { readBookManifest } from '../../golden-books/helpers/book-manifest';

export interface PixelGoldenCase {
  readonly id: string;
  readonly bookId: string;
  readonly spreadIndex: number;
  readonly width: number;
  readonly height: number;
  readonly margin: number;
  readonly lineBreaking: 'greedy' | 'optimal';
  readonly devicePixelRatio: number;
  readonly threshold: number;
  readonly maxDiffPixelRatio: number;
  readonly tags: readonly string[];
}

export interface ResolvedPixelGoldenCase {
  readonly testCase: PixelGoldenCase;
  readonly book: BookFixture;
}

type PixelCaseDefaults = Pick<
  PixelGoldenCase,
  | 'width'
  | 'height'
  | 'margin'
  | 'lineBreaking'
  | 'devicePixelRatio'
  | 'threshold'
  | 'maxDiffPixelRatio'
>;

type PixelCaseInput = Pick<PixelGoldenCase, 'id' | 'bookId' | 'spreadIndex' | 'tags'> &
  Partial<PixelCaseDefaults>;

const DEFAULT_PIXEL_CASE = {
  width: 600,
  height: 800,
  margin: 40,
  lineBreaking: 'greedy',
  devicePixelRatio: 1,
  threshold: 0.08,
  maxDiffPixelRatio: 0.015,
} as const satisfies PixelCaseDefaults;

const FRONTMATTER_FEATURE_TAGS = new Map<string, readonly string[]>([
  ['book-01:10', ['text', 'text-shadow', 'inline-background', 'transform']],
  ['book-03:1', ['block-background', 'block-transform', 'clip']],
  ['book-04:8', ['inline-border', 'text-shadow']],
  ['book-09:1', ['inline-border', 'horizontal-rule']],
  ['book-10:4', ['horizontal-rule', 'text']],
]);

const FEATURE_PIXEL_CASES: readonly PixelGoldenCase[] = [
  createPixelCase({
    id: 'book-01-frontmatter-10-dpr2',
    bookId: 'book-01',
    spreadIndex: 10,
    devicePixelRatio: 2,
    tags: ['high-dpi', 'text-shadow', 'transform'],
  }),
  createPixelCase({
    id: 'book-03-body-ruby',
    bookId: 'book-03',
    spreadIndex: 15,
    tags: ['ruby', 'text'],
  }),
  createPixelCase({
    id: 'book-07-body-ruby-cluster',
    bookId: 'book-07',
    spreadIndex: 44,
    tags: ['ruby', 'dense-text'],
  }),
  createPixelCase({
    id: 'book-10-frontmatter-05-narrow',
    bookId: 'book-10',
    spreadIndex: 5,
    width: 360,
    height: 640,
    margin: 28,
    lineBreaking: 'greedy',
    devicePixelRatio: 1,
    threshold: 0.08,
    maxDiffPixelRatio: 0.015,
    tags: ['inline-border', 'narrow-layout'],
  }),
];

export function getPixelGoldenCases(): readonly ResolvedPixelGoldenCase[] {
  const selectedIds = parseSelectedCaseIds(process.env['RITO_PIXEL_CASES']);
  const renderBooks = new Map(readRenderBooks().map((book) => [book.id, book]));
  return getAllPixelGoldenCases()
    .filter((testCase) => shouldRunCase(testCase, selectedIds))
    .map((testCase) => resolvePixelCase(testCase, renderBooks));
}

export function getAllPixelGoldenCases(): readonly PixelGoldenCase[] {
  return [...createFrontmatterCases(), ...FEATURE_PIXEL_CASES];
}

function resolvePixelCase(
  testCase: PixelGoldenCase,
  renderBooks: ReadonlyMap<string, BookFixture>,
): ResolvedPixelGoldenCase {
  const book = renderBooks.get(testCase.bookId);
  if (!book) throw new Error(`Pixel golden book ${testCase.bookId} is not enabled`);
  return { testCase, book };
}

function shouldRunCase(testCase: PixelGoldenCase, selectedIds: ReadonlySet<string>): boolean {
  return selectedIds.size === 0 || selectedIds.has(testCase.id);
}

function parseSelectedCaseIds(value: string | undefined): ReadonlySet<string> {
  if (value === undefined || value.length === 0) return new Set<string>();
  return new Set(
    value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  );
}

function createFrontmatterCases(): readonly PixelGoldenCase[] {
  return readRenderBooks().flatMap((book) => {
    const count = book.pixelFrontmatterSpreadCount;
    if (count === undefined) return [];
    return spreadIndices(count).map((spreadIndex) =>
      createPixelCase({
        id: `${book.id}-frontmatter-${String(spreadIndex).padStart(2, '0')}`,
        bookId: book.id,
        spreadIndex,
        maxDiffPixelRatio: spreadIndex === 0 ? 0.01 : DEFAULT_PIXEL_CASE.maxDiffPixelRatio,
        tags: frontmatterTags(book.id, spreadIndex),
      }),
    );
  });
}

function frontmatterTags(bookId: string, spreadIndex: number): readonly string[] {
  const base =
    spreadIndex === 0
      ? ['frontmatter', 'cover', 'image', 'page-background']
      : ['frontmatter', 'pre-body'];
  return [...base, ...(FRONTMATTER_FEATURE_TAGS.get(`${bookId}:${String(spreadIndex)}`) ?? [])];
}

function createPixelCase(input: PixelCaseInput): PixelGoldenCase {
  const merged = { ...DEFAULT_PIXEL_CASE, ...input };
  return {
    id: input.id,
    bookId: input.bookId,
    spreadIndex: input.spreadIndex,
    width: merged.width,
    height: merged.height,
    margin: merged.margin,
    lineBreaking: merged.lineBreaking,
    devicePixelRatio: merged.devicePixelRatio,
    threshold: merged.threshold,
    maxDiffPixelRatio: merged.maxDiffPixelRatio,
    tags: input.tags,
  };
}

function readRenderBooks(): readonly BookFixture[] {
  return readBookManifest().filter((book) => book.enabled && book.tiers.includes('render'));
}

function spreadIndices(count: number): readonly number[] {
  return Array.from({ length: count }, (_, index) => index);
}
