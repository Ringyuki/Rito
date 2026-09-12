import type { BrowserReaderState } from '../reader/types';
import {
  decodeBrowserReaderChapterLocalFrame,
  prepareBrowserReaderChapterLocalFrameResources,
} from './frame';
import {
  notifyBrowserReaderChapterLocalPreviewInvalidated,
  ownsBrowserReaderChapterLocalPreviewRequest,
  sameBrowserReaderChapterLocalOwner,
  sameBrowserReaderLocator,
} from './state';
import {
  closeBrowserReaderChapterLocalImages,
  failClosedBrowserReaderChapterLocalSession,
  releaseBrowserReaderChapterLocalOwner,
} from './task-support';
import type {
  BrowserReaderChapterLocalAdvance,
  BrowserReaderChapterLocalMutationResult,
  BrowserReaderChapterLocalOwner,
  BrowserReaderChapterLocalPreviewRequest,
} from './types';

/// The chapter paginates whole in one request: the advance either resolved
/// the target on the chapter's own page grid or never will.
export async function buildBrowserReaderChapterLocalPreview(
  state: BrowserReaderState,
  request: BrowserReaderChapterLocalPreviewRequest,
): Promise<void> {
  const created: unknown = await request.transport.createBoundedChapterLocalRevision({
    layoutConfig: request.layoutConfig,
    lineBreaking: request.lineBreaking,
    targetChapterIndex: request.targetChapterIndex,
    targetLocator: request.locator,
  });
  const { mutation, owner } = await acceptMutation(state, request, created);
  const releaseOwner = releaseChapterLocalOwnerOnce(state, request, owner);
  if (
    !ownsBrowserReaderChapterLocalPreviewRequest(state, request) ||
    mutation.advance.target.status !== 'resolved'
  ) {
    await releaseOwner();
    return;
  }
  try {
    await publishResolvedPreview(state, request, owner, mutation, releaseOwner);
  } catch (error) {
    await releaseOwner();
    throw error;
  }
}

interface AcceptedMutation {
  readonly mutation: BrowserReaderChapterLocalMutationResult;
  readonly owner: BrowserReaderChapterLocalOwner;
}

async function acceptMutation(
  state: BrowserReaderState,
  request: BrowserReaderChapterLocalPreviewRequest,
  value: unknown,
): Promise<AcceptedMutation> {
  const owner = extractMutationOwner(value);
  if (!owner) {
    const error = new Error('Reader chapter-local mutation returned no releasable exact owner');
    failClosedBrowserReaderChapterLocalSession(state, request, error);
    throw error;
  }
  try {
    const mutation = value as BrowserReaderChapterLocalMutationResult;
    requireAdvance(mutation.advance, request);
    return { mutation, owner };
  } catch (error) {
    await releaseBrowserReaderChapterLocalOwner(state, request, owner);
    throw error;
  }
}

async function publishResolvedPreview(
  state: BrowserReaderState,
  request: BrowserReaderChapterLocalPreviewRequest,
  owner: BrowserReaderChapterLocalOwner,
  mutation: BrowserReaderChapterLocalMutationResult,
  releaseOwner: () => Promise<void>,
): Promise<void> {
  const resolved = mutation.frame;
  if (!resolved || mutation.advance.target.status !== 'resolved') {
    throw new Error('Resolved chapter-local mutation omitted its atomic frame payload');
  }
  const localSpreadIndex = mutation.advance.target.localSpreadIndex;
  const frame = decodeBrowserReaderChapterLocalFrame(
    state,
    owner,
    localSpreadIndex,
    request.mountSpreadIndex,
    resolved,
  );
  const images = await prepareBrowserReaderChapterLocalFrameResources(
    owner,
    localSpreadIndex,
    frame,
    resolved,
  );
  if (!images || !ownsBrowserReaderChapterLocalPreviewRequest(state, request)) {
    if (images) closeBrowserReaderChapterLocalImages(images);
    await releaseOwner();
    return;
  }
  state.chapterLocalPreview.active = {
    request,
    owner,
    localSpreadIndex,
    frame,
    images,
    phase: 'paintable',
    exactSpreadIndex: undefined,
    presentationStarted: false,
  };
  notifyBrowserReaderChapterLocalPreviewInvalidated(state, request.mountSpreadIndex);
}

function releaseChapterLocalOwnerOnce(
  state: BrowserReaderState,
  request: BrowserReaderChapterLocalPreviewRequest,
  owner: BrowserReaderChapterLocalOwner,
): () => Promise<void> {
  let attempt: Promise<void> | undefined;
  return () => {
    attempt ??= releaseBrowserReaderChapterLocalOwner(state, request, owner);
    return attempt;
  };
}

function requireAdvance(
  advance: BrowserReaderChapterLocalAdvance,
  request: BrowserReaderChapterLocalPreviewRequest,
): BrowserReaderChapterLocalOwner {
  const owner: BrowserReaderChapterLocalOwner = {
    revisionId: advance.revision.revisionId,
    revisionVersion: advance.revision.revisionVersion,
    coordinate: advance.revision.coordinate,
  };
  if (
    owner.coordinate.chapterIndex !== request.targetChapterIndex ||
    owner.coordinate.href !== request.targetChapterHref ||
    !sameBrowserReaderChapterLocalOwner(advance.target.owner, owner) ||
    !sameBrowserReaderLocator(advance.target.locator, request.locator)
  ) {
    throw new Error('Reader chapter-local advance does not match its exact target owner');
  }
  return owner;
}

function extractMutationOwner(value: unknown): BrowserReaderChapterLocalOwner | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const advance = value['advance'];
  if (!isRecord(advance)) return undefined;
  const revision = advance['revision'];
  if (!isRecord(revision)) return undefined;
  const coordinate = revision['coordinate'];
  if (
    typeof revision['revisionId'] !== 'string' ||
    !Number.isSafeInteger(revision['revisionVersion']) ||
    (revision['revisionVersion'] as number) < 0 ||
    !isRecord(coordinate) ||
    coordinate['kind'] !== 'chapterLocal' ||
    !Number.isSafeInteger(coordinate['chapterIndex']) ||
    (coordinate['chapterIndex'] as number) < 0 ||
    typeof coordinate['href'] !== 'string'
  ) {
    return undefined;
  }
  return {
    revisionId: revision['revisionId'],
    revisionVersion: revision['revisionVersion'] as number,
    coordinate: {
      kind: 'chapterLocal',
      chapterIndex: coordinate['chapterIndex'] as number,
      href: coordinate['href'],
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
