import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readBookManifest } from '../golden-books/helpers/book-manifest';
import { getAllPixelGoldenCases } from '../golden-pixel/helpers/pixel-cases';
import { RENDER_GOLDEN_ROOT } from '../golden-render/helpers/render-golden-file';
import type { RenderFeature } from '../golden-render/helpers/render-page-selection';

interface RenderGoldenSummary {
  readonly selection: {
    readonly selectedPages: readonly RenderGoldenPageSelection[];
  };
  readonly cases: readonly RenderGoldenCase[];
}

interface RenderGoldenPageSelection {
  readonly features: readonly RenderFeature[];
  readonly counts: Readonly<Record<string, number>>;
}

interface RenderGoldenCase {
  readonly renders: readonly RenderGoldenRender[];
}

interface RenderGoldenRender {
  readonly records: {
    readonly methods: Readonly<Record<string, number>>;
    readonly properties: Readonly<Record<string, number>>;
  };
}

const REQUIRED_RENDER_FEATURES: readonly RenderFeature[] = [
  'first',
  'last',
  'text',
  'image',
  'inlineAtom',
  'ruby',
  'horizontalRule',
  'inlineBackground',
  'inlineBorder',
  'textShadow',
  'textDecoration',
  'blockBackground',
  'blockBorder',
  'blockTransform',
  'blockClip',
];

const REQUIRED_CANVAS_METHODS = [
  'fillRect',
  'fillText',
  'drawImage',
  'stroke',
  'clip',
  'rotate',
  'scale',
  'translate',
  'arcTo',
  'setLineDash',
] as const;

const REQUIRED_CANVAS_PROPERTIES = [
  'fillStyle',
  'font',
  'strokeStyle',
  'lineWidth',
  'shadowBlur',
  'shadowColor',
  'textBaseline',
] as const;

const REQUIRED_PIXEL_TAGS = [
  'frontmatter',
  'cover',
  'pre-body',
  'image',
  'page-background',
  'text',
  'text-shadow',
  'inline-background',
  'high-dpi',
  'ruby',
  'block-background',
  'block-transform',
  'clip',
  'inline-border',
  'horizontal-rule',
  'narrow-layout',
] as const;

describe('golden coverage', () => {
  it('keeps render command goldens covering required page features', () => {
    const coverage = collectRenderCoverage();

    expect([...coverage.features].sort()).toEqual(
      expect.arrayContaining([...REQUIRED_RENDER_FEATURES].sort()),
    );
    expect([...coverage.positiveCounts].sort()).toEqual(
      expect.arrayContaining([...countedRenderFeatures()].sort()),
    );
  });

  it('keeps render command goldens covering required canvas command families', () => {
    const coverage = collectRenderCoverage();

    expect([...coverage.methods].sort()).toEqual(
      expect.arrayContaining([...REQUIRED_CANVAS_METHODS].sort()),
    );
    expect([...coverage.properties].sort()).toEqual(
      expect.arrayContaining([...REQUIRED_CANVAS_PROPERTIES].sort()),
    );
  });

  it('keeps pixel goldens covering final-output feature tags', () => {
    const tags = new Set(getAllPixelGoldenCases().flatMap((testCase) => testCase.tags));
    expect([...tags].sort()).toEqual(expect.arrayContaining([...REQUIRED_PIXEL_TAGS].sort()));
  });

  it('keeps pixel goldens covering frontmatter spreads for every render book', () => {
    const expected = new Set(
      readBookManifest()
        .filter((book) => book.enabled && book.tiers.includes('render'))
        .flatMap((book) => frontmatterKeys(book.id, requireFrontmatterSpreadCount(book))),
    );
    const actual = new Set(
      getAllPixelGoldenCases()
        .filter((testCase) => testCase.tags.includes('frontmatter'))
        .map((testCase) => pixelCaseKey(testCase.bookId, testCase.spreadIndex)),
    );

    expect(actual).toEqual(expected);
  });
});

function collectRenderCoverage() {
  const coverage = {
    features: new Set<string>(),
    positiveCounts: new Set<string>(),
    methods: new Set<string>(),
    properties: new Set<string>(),
  };

  for (const file of collectJsonFiles(RENDER_GOLDEN_ROOT)) {
    addRenderSummaryCoverage(coverage, readRenderSummary(file));
  }
  return coverage;
}

function addRenderSummaryCoverage(
  coverage: ReturnType<typeof collectRenderCoverage>,
  summary: RenderGoldenSummary,
): void {
  for (const page of summary.selection.selectedPages) {
    for (const feature of page.features) coverage.features.add(feature);
    addPositiveKeys(coverage.positiveCounts, page.counts);
  }
  for (const testCase of summary.cases) {
    for (const render of testCase.renders) {
      addPositiveKeys(coverage.methods, render.records.methods);
      addPositiveKeys(coverage.properties, render.records.properties);
    }
  }
}

function countedRenderFeatures(): readonly string[] {
  return REQUIRED_RENDER_FEATURES.filter((feature) => feature !== 'first' && feature !== 'last');
}

function addPositiveKeys(target: Set<string>, counts: Readonly<Record<string, number>>): void {
  for (const [key, value] of Object.entries(counts)) {
    if (value > 0) target.add(key);
  }
}

function readRenderSummary(file: string): RenderGoldenSummary {
  return JSON.parse(readFileSync(file, 'utf8')) as RenderGoldenSummary;
}

function collectJsonFiles(root: string): readonly string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) return collectJsonFiles(path);
    return entry.isFile() && entry.name.endsWith('.json') ? [path] : [];
  });
}

function frontmatterKeys(bookId: string, count: number): readonly string[] {
  return Array.from({ length: count }, (_, spreadIndex) => pixelCaseKey(bookId, spreadIndex));
}

function pixelCaseKey(bookId: string, spreadIndex: number): string {
  return `${bookId}:${String(spreadIndex)}`;
}

function requireFrontmatterSpreadCount(book: ReturnType<typeof readBookManifest>[number]): number {
  const count = book.pixelFrontmatterSpreadCount;
  expect(count, `${book.id} must define pixelFrontmatterSpreadCount`).toBeDefined();
  return count ?? 0;
}
