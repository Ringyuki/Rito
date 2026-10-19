import type {
  ReaderInteractionTarget,
  ReaderInteractionTargetKind,
  ReaderPageReadingAnchor,
  ReaderPageSemantics,
  ReaderPageTargets,
  ReaderSemanticNode,
} from '../../../reader';
import type { BrowserReaderArtifact, BrowserReaderPageRecords } from '../reader-session';
import { ensureSessionReaderFrame } from './frames';
import {
  askSessionReaderLayout,
  captureSessionReaderLayout,
  readerLocator,
  readerSourcePoint,
  requireSessionReaderPageIndex,
  sessionReaderPagePlace,
  sessionReaderPageRect,
  type SessionReaderCapture,
  type SessionReaderPagePlace,
} from './page-space';
import { sessionReaderClosed, type SessionReaderState } from './state';

type ArtifactHit = BrowserReaderPageRecords['hits'][number];
type ArtifactSemanticNode = BrowserReaderPageRecords['semantics'][number];

const TARGET_KINDS = {
  text: 'text',
  link: 'link',
  image: 'image',
  footnote: 'footnote',
  'footnote-pending': 'footnotePending',
} as const satisfies Record<ArtifactHit['kind'], ReaderInteractionTargetKind>;

const SEMANTIC_ROLES = {
  heading: 'heading',
  paragraph: 'paragraph',
  list: 'list',
  'list-item': 'listitem',
  image: 'image',
  link: 'link',
  blockquote: 'blockquote',
  table: 'table',
  generic: 'generic',
} as const satisfies Record<ArtifactSemanticNode['role'], ReaderSemanticNode['role']>;

/** One page of the committed layout and what its spread's artifact holds for it. */
interface PublishedPage {
  readonly capture: SessionReaderCapture;
  readonly place: SessionReaderPagePlace;
  readonly artifact: BrowserReaderArtifact;
  readonly page: BrowserReaderPageRecords;
}

/**
 * The page as the artifact of its spread holds it, loading the spread when
 * it is not held. Undefined when the page is not in the committed layout,
 * or the layout was replaced while its spread loaded.
 */
async function publishedPage(
  state: SessionReaderState,
  pageIndex: number,
): Promise<PublishedPage | undefined> {
  requireSessionReaderPageIndex(pageIndex);
  if (state.disposed) return undefined;
  const capture = captureSessionReaderLayout(state);
  const place = sessionReaderPagePlace(capture, pageIndex);
  if (!place) return undefined;
  const frame = await ensureSessionReaderFrame(state, place.spreadIndex);
  if (!frame || sessionReaderClosed(state) || capture.generation !== state.layoutGeneration) {
    return undefined;
  }
  if (!frame.artifact.pages.some((candidate) => candidate.pageIndex === pageIndex))
    return undefined;
  const page = await askSessionReaderLayout(state, () =>
    state.session.readPage(frame.artifact.artifactId, pageIndex),
  );
  return page ? { capture, place, artifact: frame.artifact, page } : undefined;
}

export async function sessionReaderPageTargets(
  state: SessionReaderState,
  pageIndex: number,
): Promise<ReaderPageTargets | undefined> {
  const published = await publishedPage(state, pageIndex);
  if (!published) return undefined;
  const { capture, place, page } = published;
  const chapterHref = capture.view.chapterHrefByPage[pageIndex];
  return {
    pageIndex,
    spreadIndex: place.spreadIndex,
    targets: page.hits.map((hit) => interactionTarget(hit, place, chapterHref)),
  };
}

function interactionTarget(
  hit: ArtifactHit,
  place: SessionReaderPagePlace,
  chapterHref: string | undefined,
): ReaderInteractionTarget {
  return {
    kind: TARGET_KINDS[hit.kind],
    bounds: sessionReaderPageRect(place, hit.bounds),
    // An image's name is its alternative text.
    label: hit.text === '' ? (hit.imageAlt ?? '') : hit.text,
    ...(hit.href === undefined ? {} : { href: hit.href }),
    ...(hit.sourcePoint === undefined || chapterHref === undefined
      ? {}
      : {
          sourceLocator: { href: chapterHref, sourcePoint: readerSourcePoint(hit.sourcePoint) },
        }),
    ...(hit.targetLocator === undefined ? {} : { targetLocator: readerLocator(hit.targetLocator) }),
    ...(hit.destinationLabel === undefined ? {} : { destinationLabel: hit.destinationLabel }),
    ...(hit.imageSrc === undefined ? {} : { imageSrc: hit.imageSrc }),
    ...(hit.imageAlt === undefined ? {} : { imageAlt: hit.imageAlt }),
    ...(hit.footnoteKey === undefined ? {} : { footnoteKey: hit.footnoteKey }),
  };
}

export async function sessionReaderPageSemantics(
  state: SessionReaderState,
  pageIndex: number,
): Promise<ReaderPageSemantics | undefined> {
  const published = await publishedPage(state, pageIndex);
  if (!published) return undefined;
  const { place, page } = published;
  return {
    pageIndex,
    spreadIndex: place.spreadIndex,
    nodes: page.semantics.map((node) => semanticNode(node, place)),
  };
}

function semanticNode(
  node: ArtifactSemanticNode,
  place: SessionReaderPagePlace,
): ReaderSemanticNode {
  return {
    role: SEMANTIC_ROLES[node.role],
    bounds: sessionReaderPageRect(place, node.bounds),
    ...(node.level === undefined ? {} : { level: node.level }),
    ...(node.text === undefined ? {} : { text: node.text }),
    ...(node.alt === undefined ? {} : { alt: node.alt }),
    ...(node.href === undefined ? {} : { href: node.href }),
    children: node.children.map((child) => semanticNode(child, place)),
  };
}

/**
 * The durable position of a page. A spread's artifact carries the locator
 * of its first page — where it was asked to open, or the page's first
 * source content. A second page is anchored at its own first content.
 */
export async function sessionReaderPageReadingAnchor(
  state: SessionReaderState,
  pageIndex: number,
): Promise<ReaderPageReadingAnchor | undefined> {
  const published = await publishedPage(state, pageIndex);
  if (!published) return undefined;
  const { capture, place, artifact, page } = published;
  const projection = { pageIndex, spreadIndex: place.spreadIndex };
  if (artifact.localPageIndexes[0] === pageIndex) {
    return { status: 'resolved', ...projection, locator: readerLocator(artifact.locator) };
  }
  const href = capture.view.chapterHrefByPage[pageIndex];
  const sourcePoint = page.hits.find((hit) => hit.sourcePoint !== undefined)?.sourcePoint;
  if (href === undefined)
    return { status: 'unavailable', ...projection, reason: 'sourceUnavailable' };
  if (sourcePoint === undefined) {
    return { status: 'unavailable', ...projection, reason: 'noSourceContent' };
  }
  return {
    status: 'resolved',
    ...projection,
    locator: { href, sourcePoint: readerSourcePoint(sourcePoint) },
  };
}
