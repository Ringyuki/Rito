import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readBookManifest } from '../golden-books/helpers/book-manifest';
import {
  getAllFullPixelGoldenRuns,
  getAllPixelGoldenProfiles,
  getAllPixelGoldenRuns,
  getCommittedPixelGoldenProfiles,
} from '../golden-pixel/helpers/pixel-cases';
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
  'curated-sample',
  'frontmatter',
  'body',
  'pre-body',
  'post-body',
  'line-breaking',
  'greedy',
  'knuth-plass',
  'single-page',
  'double-page',
  'default-layout',
  'narrow-layout',
  'wide-layout',
  'line-breaking-stress',
  'high-dpi',
] as const;

const REQUIRED_FULL_PIXEL_TAGS = ['full-book', 'double-page', 'high-dpi'] as const;

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
    const tags = new Set(getAllPixelGoldenRuns().flatMap((run) => run.tags));
    expect([...tags].sort()).toEqual(expect.arrayContaining([...REQUIRED_PIXEL_TAGS].sort()));
  });

  it('keeps committed pixel goldens covering every render book with committed profiles', () => {
    const profiles = getCommittedPixelGoldenProfiles();
    const expected = renderBookIds().flatMap((bookId) =>
      profiles.map((profile) => pixelProfileKey(bookId, profile.id)),
    );
    const actual = new Set(
      getAllPixelGoldenRuns().map((run) => pixelProfileKey(run.bookId, run.profile.id)),
    );

    expect(actual).toEqual(new Set(expected));
  });

  it('keeps optional full pixel runs covering every render book with every profile', () => {
    const profiles = getAllPixelGoldenProfiles();
    const expected = renderBookIds().flatMap((bookId) =>
      profiles.map((profile) => pixelProfileKey(bookId, profile.id)),
    );
    const fullRuns = getAllFullPixelGoldenRuns();
    const actual = new Set(fullRuns.map((run) => pixelProfileKey(run.bookId, run.profile.id)));
    const tags = new Set(fullRuns.flatMap((run) => run.tags));

    expect(actual).toEqual(new Set(expected));
    expect([...tags].sort()).toEqual(expect.arrayContaining([...REQUIRED_FULL_PIXEL_TAGS].sort()));
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

function renderBookIds(): readonly string[] {
  return readBookManifest()
    .filter((book) => book.enabled && book.tiers.includes('render'))
    .map((book) => book.id);
}

function pixelProfileKey(bookId: string, profileId: string): string {
  return `${bookId}:${profileId}`;
}
