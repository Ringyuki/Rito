import { buildHitMap } from '../../interaction/core/hit-map';
import type { LayoutConfig, Page, Rect, Spread } from '../../layout/core/types';
import { collectSpreadImageSources } from '../../render/assets/image-sources';
import { buildSpreadDisplayList } from '../../render/display-list';
import type { DisplayListOptions } from '../../render/display-list/types';
import type {
  ReaderFootnoteRef,
  ReaderInteractionTarget,
  ReaderLocator,
  ReaderResourceRef,
  ReaderRevisionId,
  ReaderSessionId,
  ReaderSpreadFrame,
  ReaderTextRunTarget,
} from './types';

type HitEntry = ReturnType<typeof buildHitMap>['entries'][number];
type PageSide = 'left' | 'right';

export interface ReaderFrameLocatorInput {
  readonly kind: ReaderInteractionTarget['kind'] | 'primary';
  readonly spreadIndex: number;
  readonly pageIndex?: number;
  readonly pageSide?: PageSide;
  readonly rect?: Rect;
  readonly text?: string;
  readonly href?: string;
  readonly imageSrc?: string;
  readonly sourcePath?: readonly number[];
  readonly sourceText?: string;
  readonly sourceTextOffset?: number;
}

export interface ReaderFrameFootnoteRefInput {
  readonly href: string;
  readonly pageIndex?: number;
}

export interface BuildReaderSpreadFrameInput {
  readonly sessionId: ReaderSessionId;
  readonly revisionId: ReaderRevisionId;
  readonly spread: Spread;
  readonly layout: LayoutConfig;
  readonly displayListOptions?: DisplayListOptions;
  readonly createResourceRef?: (href: string) => ReaderResourceRef;
  readonly createLocator?: (input: ReaderFrameLocatorInput) => ReaderLocator;
  readonly resolveFootnoteRef?: (
    input: ReaderFrameFootnoteRefInput,
  ) => ReaderFootnoteRef | undefined;
}

interface PageContext {
  readonly page: Page;
  readonly side: PageSide;
  readonly offsetX: number;
}

interface FrameTargets {
  readonly textRuns: readonly ReaderTextRunTarget[];
  readonly targets: readonly ReaderInteractionTarget[];
  readonly primaryLocatorInput?: ReaderFrameLocatorInput;
}

export function buildReaderSpreadFrame(input: BuildReaderSpreadFrameInput): ReaderSpreadFrame {
  const createResourceRef = input.createResourceRef ?? createDefaultResourceRef;
  const createLocator = input.createLocator ?? createDefaultLocator;
  const resourceRefs = collectResourceRefs(input.spread, createResourceRef);
  const resourceRefByHref = new Map(resourceRefs.map((resource) => [resource.href, resource]));
  const frameTargets = collectFrameTargets(input, createLocator, resourceRefByHref);

  return {
    sessionId: input.sessionId,
    revisionId: input.revisionId,
    spreadIndex: input.spread.index,
    pageIndexes: collectPageIndexes(input.spread),
    viewport: {
      width: input.layout.viewportWidth,
      height: input.layout.viewportHeight,
    },
    displayList: buildSpreadDisplayList(input.spread, input.layout, input.displayListOptions),
    textRuns: frameTargets.textRuns,
    targets: frameTargets.targets,
    resourceRefs,
    primaryLocator: createLocator(
      frameTargets.primaryLocatorInput ?? fallbackLocatorInput(input.spread, input.layout),
    ),
  };
}

function collectResourceRefs(
  spread: Spread,
  createResourceRef: (href: string) => ReaderResourceRef,
): readonly ReaderResourceRef[] {
  return collectSpreadImageSources(spread).map(createResourceRef);
}

function collectPageIndexes(spread: Spread): readonly number[] {
  const indexes: number[] = [];
  if (spread.left) indexes.push(spread.left.index);
  if (spread.right) indexes.push(spread.right.index);
  return indexes;
}

function collectFrameTargets(
  input: BuildReaderSpreadFrameInput,
  createLocator: (input: ReaderFrameLocatorInput) => ReaderLocator,
  resourceRefByHref: ReadonlyMap<string, ReaderResourceRef>,
): FrameTargets {
  const textRuns: ReaderTextRunTarget[] = [];
  const targets: ReaderInteractionTarget[] = [];
  let primaryLocatorInput: ReaderFrameLocatorInput | undefined;

  for (const pageContext of pageContexts(input.spread, input.layout)) {
    const hitMap = buildHitMap(pageContext.page);
    for (const hit of hitMap.entries) {
      const rect = toSpreadRect(hit.bounds, input.layout, pageContext.offsetX);
      const footnoteRef = footnoteRefFromHit(input, pageContext, hit);
      const kind = targetKind(hit, footnoteRef);
      const locatorInput = locatorInputFromHit(input.spread.index, pageContext, hit, rect, kind);
      const locator = createLocator(locatorInput);

      if (!primaryLocatorInput && hit.sourceRef && hit.text.length > 0) {
        primaryLocatorInput = { ...locatorInput, kind: 'primary' };
      }
      if (hit.text.length > 0) {
        textRuns.push(textRunTarget(hit, rect, locator));
      }
      targets.push(interactionTarget(hit, rect, locator, resourceRefByHref, kind, footnoteRef));
    }
  }

  return { textRuns, targets, ...(primaryLocatorInput ? { primaryLocatorInput } : {}) };
}

function pageContexts(spread: Spread, layout: LayoutConfig): readonly PageContext[] {
  const contexts: PageContext[] = [];
  if (spread.left) contexts.push({ page: spread.left, side: 'left', offsetX: 0 });
  if (spread.right) {
    contexts.push({
      page: spread.right,
      side: 'right',
      offsetX: layout.pageWidth + layout.spreadGap,
    });
  }
  return contexts;
}

function toSpreadRect(bounds: Rect, layout: LayoutConfig, pageOffsetX: number): Rect {
  return {
    x: pageOffsetX + layout.marginLeft + bounds.x,
    y: layout.marginTop + bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function locatorInputFromHit(
  spreadIndex: number,
  pageContext: PageContext,
  hit: HitEntry,
  rect: Rect,
  kind: ReaderInteractionTarget['kind'],
): ReaderFrameLocatorInput {
  return {
    kind,
    spreadIndex,
    pageIndex: pageContext.page.index,
    pageSide: pageContext.side,
    rect,
    ...(hit.text ? { text: hit.text } : {}),
    ...(hit.href ? { href: hit.href } : {}),
    ...(hit.imageSrc ? { imageSrc: hit.imageSrc } : {}),
    ...(hit.sourceRef ? { sourcePath: hit.sourceRef.nodePath } : {}),
    ...(hit.sourceText ? { sourceText: hit.sourceText } : {}),
    ...(hit.sourceTextOffset !== undefined ? { sourceTextOffset: hit.sourceTextOffset } : {}),
  };
}

function textRunTarget(hit: HitEntry, rect: Rect, locator: ReaderLocator): ReaderTextRunTarget {
  return {
    rect,
    text: hit.text,
    locator,
    ...(hit.sourceTextOffset !== undefined ? { sourceTextOffset: hit.sourceTextOffset } : {}),
  };
}

function interactionTarget(
  hit: HitEntry,
  rect: Rect,
  locator: ReaderLocator,
  resourceRefByHref: ReadonlyMap<string, ReaderResourceRef>,
  kind: ReaderInteractionTarget['kind'],
  footnoteRef: ReaderFootnoteRef | undefined,
): ReaderInteractionTarget {
  const resourceRef = hit.imageSrc ? resourceRefByHref.get(hit.imageSrc) : undefined;
  return {
    kind,
    rect,
    locator,
    label: targetLabel(hit),
    ...(hit.href ? { href: hit.href } : {}),
    ...(footnoteRef ? { footnoteRef } : {}),
    ...(resourceRef ? { resourceRef } : {}),
  };
}

function footnoteRefFromHit(
  input: BuildReaderSpreadFrameInput,
  pageContext: PageContext,
  hit: HitEntry,
): ReaderFootnoteRef | undefined {
  if (!hit.href || hit.imageSrc) return undefined;
  return input.resolveFootnoteRef?.({ href: hit.href, pageIndex: pageContext.page.index });
}

function targetKind(
  hit: HitEntry,
  footnoteRef: ReaderFootnoteRef | undefined,
): ReaderInteractionTarget['kind'] {
  if (hit.imageSrc) return 'image';
  if (footnoteRef) return 'footnote';
  if (hit.href) return 'link';
  return 'text';
}

function targetLabel(hit: HitEntry): string {
  return hit.text || hit.imageAlt || hit.href || hit.imageSrc || '';
}

function fallbackLocatorInput(spread: Spread, layout: LayoutConfig): ReaderFrameLocatorInput {
  const firstPage = spread.left ?? spread.right;
  return {
    kind: 'primary',
    spreadIndex: spread.index,
    ...(firstPage ? { pageIndex: firstPage.index } : {}),
    rect: { x: 0, y: 0, width: layout.viewportWidth, height: layout.viewportHeight },
  };
}

function createDefaultResourceRef(href: string): ReaderResourceRef {
  const mediaType = inferImageMediaType(href);
  return {
    id: `image:${href}`,
    kind: 'image',
    href,
    ...(mediaType ? { mediaType } : {}),
  };
}

function createDefaultLocator(input: ReaderFrameLocatorInput): ReaderLocator {
  const href = input.href ?? input.imageSrc ?? pageHref(input);
  return {
    href,
    mediaType: input.imageSrc
      ? (inferImageMediaType(input.imageSrc) ?? 'image/*')
      : 'application/xhtml+xml',
    progression: 0,
    ...(input.pageIndex !== undefined ? { position: input.pageIndex } : {}),
  };
}

function pageHref(input: ReaderFrameLocatorInput): string {
  return input.pageIndex !== undefined
    ? `page:${String(input.pageIndex)}`
    : `spread:${String(input.spreadIndex)}`;
}

function inferImageMediaType(href: string): string | undefined {
  const lower = href.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return undefined;
}
