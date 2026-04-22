import type {
  HorizontalRule,
  ImageElement,
  InlineAtom,
  LayoutBlock,
  LineBox,
  Page,
  RubyAnnotation,
  TextRun,
} from '../../../src/layout/core';

export type RenderFeature =
  | 'first'
  | 'last'
  | 'text'
  | 'image'
  | 'inlineAtom'
  | 'ruby'
  | 'horizontalRule'
  | 'inlineBackground'
  | 'inlineBorder'
  | 'textShadow'
  | 'textDecoration'
  | 'blockBackground'
  | 'blockBorder'
  | 'blockTransform'
  | 'blockOpacity'
  | 'blockClip';

export interface RenderPageCase {
  readonly id: string;
  readonly pageIndex: number;
  readonly features: readonly RenderFeature[];
  readonly counts: RenderFeatureCounts;
}

export interface RenderFeatureCounts {
  readonly text: number;
  readonly image: number;
  readonly inlineAtom: number;
  readonly ruby: number;
  readonly horizontalRule: number;
  readonly inlineBackground: number;
  readonly inlineBorder: number;
  readonly textShadow: number;
  readonly textDecoration: number;
  readonly blockBackground: number;
  readonly blockBorder: number;
  readonly blockTransform: number;
  readonly blockOpacity: number;
  readonly blockClip: number;
}

type CountedFeature = keyof RenderFeatureCounts;

const COUNTED_FEATURES: readonly CountedFeature[] = [
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
  'blockOpacity',
  'blockClip',
];

const FEATURE_PRIORITY: readonly RenderFeature[] = ['first', 'last', ...COUNTED_FEATURES];

export function selectRenderPageCases(
  pages: readonly Page[],
  bookId: string,
  configId: string,
): readonly RenderPageCase[] {
  const pageFeatures = pages.map((page) => ({ page, counts: countRenderFeatures(page) }));
  const selected = new Map<number, Set<RenderFeature>>();

  if (pages.length > 0) addFeature(selected, 0, 'first');
  if (pages.length > 1) addFeature(selected, pages.length - 1, 'last');

  for (const feature of COUNTED_FEATURES) {
    const best = findBestPage(pageFeatures, feature);
    if (best) addFeature(selected, best.page.index, feature);
  }

  return [...selected.entries()]
    .sort(([left], [right]) => left - right)
    .map(([pageIndex, features]) =>
      createRenderPageCase(bookId, configId, pageIndex, features, pageFeatures),
    );
}

function countRenderFeatures(page: Page): RenderFeatureCounts {
  const counts = createMutableCounts();
  for (const block of page.content) countBlock(block, counts);
  return counts;
}

function countBlock(block: LayoutBlock, counts: MutableRenderFeatureCounts): void {
  const paint = block.paint;
  if (paint?.background) counts.blockBackground += 1;
  if (paint?.border || block.borderBox) counts.blockBorder += 1;
  if (paint?.transform && paint.transform.length > 0) counts.blockTransform += 1;
  if (paint?.opacity !== undefined && paint.opacity < 1) counts.blockOpacity += 1;
  if (paint?.clipToBounds === true) counts.blockClip += 1;

  for (const child of block.children) countChild(child, counts);
}

function countChild(
  child: LineBox | LayoutBlock | ImageElement | HorizontalRule,
  counts: MutableRenderFeatureCounts,
): void {
  switch (child.type) {
    case 'line-box':
      countLine(child, counts);
      break;
    case 'layout-block':
      countBlock(child, counts);
      break;
    case 'image':
      counts.image += 1;
      break;
    case 'hr':
      counts.horizontalRule += 1;
      break;
  }
}

function countLine(line: LineBox, counts: MutableRenderFeatureCounts): void {
  for (const run of line.runs) countRun(run, counts);
}

function countRun(
  run: TextRun | InlineAtom | RubyAnnotation,
  counts: MutableRenderFeatureCounts,
): void {
  if (run.type === 'text-run') {
    counts.text += 1;
    if (run.paint.backgroundColor) counts.inlineBackground += 1;
    if (run.paint.border) counts.inlineBorder += 1;
    if (run.paint.textShadow && run.paint.textShadow.length > 0) counts.textShadow += 1;
    if (run.paint.decoration) counts.textDecoration += 1;
    return;
  }
  if (run.type === 'ruby-annotation') {
    counts.ruby += 1;
    return;
  }
  counts.inlineAtom += 1;
  if (run.imageSrc) counts.image += 1;
  if (run.block) countBlock(run.block, counts);
}

function findBestPage(
  pageFeatures: readonly { readonly page: Page; readonly counts: RenderFeatureCounts }[],
  feature: CountedFeature,
): { readonly page: Page; readonly counts: RenderFeatureCounts } | undefined {
  let best: { readonly page: Page; readonly counts: RenderFeatureCounts } | undefined;
  for (const candidate of pageFeatures) {
    if (candidate.counts[feature] <= 0) continue;
    if (!best || candidate.counts[feature] > best.counts[feature]) best = candidate;
  }
  return best;
}

function addFeature(
  selected: Map<number, Set<RenderFeature>>,
  pageIndex: number,
  feature: RenderFeature,
): void {
  const features = selected.get(pageIndex) ?? new Set<RenderFeature>();
  features.add(feature);
  selected.set(pageIndex, features);
}

function createRenderPageCase(
  bookId: string,
  configId: string,
  pageIndex: number,
  selectedFeatures: ReadonlySet<RenderFeature>,
  pageFeatures: readonly { readonly page: Page; readonly counts: RenderFeatureCounts }[],
): RenderPageCase {
  const found = pageFeatures.find((entry) => entry.page.index === pageIndex);
  if (!found) throw new Error(`Missing selected render page ${String(pageIndex)}`);
  return {
    id: `${bookId}-${configId}-page-${String(pageIndex).padStart(4, '0')}`,
    pageIndex,
    features: orderFeatures(selectedFeatures),
    counts: found.counts,
  };
}

function orderFeatures(features: ReadonlySet<RenderFeature>): readonly RenderFeature[] {
  return FEATURE_PRIORITY.filter((feature) => features.has(feature));
}

type MutableRenderFeatureCounts = {
  -readonly [K in keyof RenderFeatureCounts]: RenderFeatureCounts[K];
};

function createMutableCounts(): MutableRenderFeatureCounts {
  return {
    text: 0,
    image: 0,
    inlineAtom: 0,
    ruby: 0,
    horizontalRule: 0,
    inlineBackground: 0,
    inlineBorder: 0,
    textShadow: 0,
    textDecoration: 0,
    blockBackground: 0,
    blockBorder: 0,
    blockTransform: 0,
    blockOpacity: 0,
    blockClip: 0,
  };
}
