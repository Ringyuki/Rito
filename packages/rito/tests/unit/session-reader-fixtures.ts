import { RitoReaderError } from '@ritojs/core-wasm/decoder';

import type {
  BrowserReaderArtifact,
  BrowserReaderArtifactRequest,
  BrowserReaderLocator,
  BrowserReaderNavigationQuery,
  BrowserReaderNavigationResult,
  BrowserReaderPublication,
  BrowserReaderSession,
} from '../../src/bindings/browser/reader-session';

/** The session's live-artifact cap, as the engine enforces it. */
export const LIVE_ARTIFACT_CAP = 6;

export interface FakeChapter {
  readonly idref: string;
  readonly href: string;
  /** Pages at a 16px root font size; a larger size lays out proportionally more. */
  readonly pages: number;
}

interface Revision {
  readonly id: bigint;
  readonly layout: BrowserReaderArtifactRequest['layout'];
  /** The one chapter a chapter-local revision lays out; undefined for the whole book. */
  readonly chapterIndex: number | undefined;
}

interface Owned {
  readonly artifact: BrowserReaderArtifact;
  readonly revision: Revision;
  readonly origin: 'request' | 'peek' | 'background';
}

/**
 * A reader session that keeps the protocol's rules without an engine: a
 * request lays out one chapter, the background step lays out the book, a
 * spread is addressed by its position, every replacement of the visible
 * artifact is a compare-and-swap, and at most six artifacts are live.
 */
export class FakeReaderSession {
  readonly sessionId = 7n;
  readonly calls: string[] = [];
  readonly requests: BrowserReaderArtifactRequest[] = [];
  readonly live = new Map<bigint, Owned>();
  maxLive = 0;
  visibleId: bigint | undefined;
  disposed = false;
  /** While set, the whole-book step waits on it: the session is occupied. */
  backgroundGate: Promise<void> | undefined;
  private nextArtifactId = 1n;
  private nextRevisionId = 1n;
  private nextRequestId = 1n;
  private readonly peeked = new Set<bigint>();
  private readonly books = new Map<string, Revision>();
  private readonly candidates = new Map<bigint, bigint>();
  initialArtifact!: BrowserReaderArtifact;

  constructor(
    readonly chapters: readonly FakeChapter[],
    request: BrowserReaderArtifactRequest,
  ) {
    this.initialArtifact = this.request(request);
  }

  session(): BrowserReaderSession {
    const later = <Value>(run: () => Value): Promise<Value> =>
      new Promise((resolve, reject) => {
        setTimeout(() => {
          try {
            if (this.disposed) throw new RitoReaderError('session-disposed', 'disposed');
            resolve(run());
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        }, 0);
      });
    const session: Partial<BrowserReaderSession> = {
      sessionId: this.sessionId,
      initialArtifact: this.initialArtifact,
      readPublication: () => later(() => this.publication()),
      requestArtifact: (request) => later(() => this.request(request)),
      peekSpread: (from, spreadIndex) => later(() => this.peekSpread(from, spreadIndex)),
      commitPeekedArtifact: (expected, candidate) =>
        later(() => this.commit(expected, candidate, true)),
      adoptForegroundCandidate: (expected, candidate) =>
        later(() => this.commit(expected, candidate, false)),
      advanceBackgroundOnce: async (expected) => {
        this.calls.push('advance');
        if (this.backgroundGate) await this.backgroundGate;
        return later(() => this.advance(expected));
      },
      adoptBackgroundCandidate: (expected, candidate) =>
        later(() => {
          if (this.candidates.get(candidate) !== expected || this.visibleId !== expected) {
            throw new RitoReaderError('stale-request', 'background candidate is stale');
          }
          this.candidates.delete(candidate);
          this.visibleId = candidate;
          this.calls.push(`adopt-background ${String(candidate)}`);
          return {
            intentRequestId: 0n,
            replacedArtifactId: expected,
            visibleArtifactId: candidate,
          };
        }),
      navigation: (query) => later(() => this.navigation(query)),
      release: (artifactId) =>
        later(() => {
          if (artifactId === this.visibleId) throw new Error('released the visible artifact');
          this.peeked.delete(artifactId);
          this.candidates.delete(artifactId);
          return this.live.delete(artifactId);
        }),
      dispose: () => {
        this.disposed = true;
        this.live.clear();
        return Promise.resolve();
      },
    };
    return session as BrowserReaderSession;
  }

  /** The spread index the visible artifact draws, in its revision. */
  visibleSpread(): number | undefined {
    return this.visibleId === undefined
      ? undefined
      : this.live.get(this.visibleId)?.artifact.localSpreadIndex;
  }

  pagesOf(chapterIndex: number, layout: BrowserReaderArtifactRequest['layout']): number {
    const chapter = this.chapters[chapterIndex];
    if (!chapter) throw new Error('no such chapter');
    return Math.max(1, Math.round((chapter.pages * layout.rootFontSize) / 16));
  }

  private publication(): BrowserReaderPublication {
    return {
      protocolVersion: 1,
      sessionId: this.sessionId,
      metadata: { title: 'Fake book', language: 'en', identifier: 'fake' },
      spine: this.chapters.map((chapter, spineIndex) => ({
        spineIndex,
        linearIndex: spineIndex,
        idref: chapter.idref,
        href: chapter.href,
      })),
      toc: this.chapters.map((chapter, tocId) => ({
        tocId,
        label: chapter.idref,
        target: { kind: 'locator', spineIndex: tocId, locator: { href: chapter.href } },
        children: [],
      })),
    };
  }

  private request(request: BrowserReaderArtifactRequest): BrowserReaderArtifact {
    this.requests.push(request);
    this.calls.push(`request ${request.locator.href || '(start)'}`);
    const chapterIndex =
      request.locator.href === ''
        ? 0
        : this.chapters.findIndex((chapter) => chapter.href === request.locator.href);
    if (chapterIndex < 0) throw new RitoReaderError('invalid-locator', 'unknown chapter');
    const revision: Revision = { id: this.nextRevisionId++, layout: request.layout, chapterIndex };
    const pages = this.pagesOf(chapterIndex, request.layout);
    const page = Math.round((request.locator.progression ?? 0) * (pages - 1));
    return this.publish(revision, page, 'request', request.locator);
  }

  private peekSpread(from: bigint, spreadIndex: number): BrowserReaderArtifact {
    const source = this.live.get(from);
    if (!source) throw new RitoReaderError('unknown-artifact', 'peek source is not live');
    if (spreadIndex < 0 || spreadIndex >= this.spreadCount(source.revision)) {
      throw new RitoReaderError('invalid-request', 'spread is not in the revision');
    }
    this.calls.push(`peek ${String(spreadIndex)}`);
    const artifact = this.publish(source.revision, spreadIndex, 'peek');
    this.peeked.add(artifact.artifactId);
    return artifact;
  }

  private commit(expected: bigint | undefined, candidate: bigint, peek: boolean) {
    if (this.visibleId !== expected || !this.live.has(candidate)) {
      throw new RitoReaderError('stale-request', 'visible artifact is not the expected one');
    }
    if (peek && !this.peeked.delete(candidate)) {
      throw new RitoReaderError('stale-request', 'artifact is not a committable peek');
    }
    this.visibleId = candidate;
    this.calls.push(`${peek ? 'commit' : 'adopt'} ${String(candidate)}`);
    return { intentRequestId: 0n, replacedArtifactId: expected, visibleArtifactId: candidate };
  }

  private advance(expected: bigint) {
    if (this.visibleId !== expected) {
      throw new RitoReaderError('stale-request', 'background guard is stale');
    }
    const visible = this.live.get(expected);
    if (!visible) throw new RitoReaderError('unknown-artifact', 'visible artifact is not live');
    const key = JSON.stringify(visible.revision.layout);
    let book = this.books.get(key);
    if (!book) {
      book = {
        id: this.nextRevisionId++,
        layout: visible.revision.layout,
        chapterIndex: undefined,
      };
      this.books.set(key, book);
    }
    const chapterIndex = visible.revision.chapterIndex ?? 0;
    const page = this.chapterStart(chapterIndex, book.layout) + visible.artifact.localPageIndex;
    const artifact = this.publish(book, page, 'background');
    this.candidates.set(artifact.artifactId, expected);
    return {
      state: 'started' as const,
      intentRequestId: 0n,
      replacesArtifactId: expected,
      movesVisibleContent: false,
      artifact,
    };
  }

  private navigation(query: BrowserReaderNavigationQuery): BrowserReaderNavigationResult {
    if (query.kind !== 'layout' && query.kind !== 'locate') {
      throw new Error(`unexpected navigation query ${query.kind}`);
    }
    const owned = this.live.get(query.artifactId);
    if (!owned) throw new RitoReaderError('unknown-artifact', 'navigation artifact is not live');
    const { revision } = owned;
    if (query.kind === 'locate') {
      const chapterIndex = this.chapters.findIndex(
        (chapter) => chapter.href === query.locator.href,
      );
      if (chapterIndex < 0) return { kind: 'location', location: { kind: 'unavailable' } };
      if (revision.chapterIndex !== undefined && revision.chapterIndex !== chapterIndex) {
        return { kind: 'location', location: { kind: 'not-laid-out' } };
      }
      const pages = this.pagesOf(chapterIndex, revision.layout);
      const start =
        revision.chapterIndex === undefined ? this.chapterStart(chapterIndex, revision.layout) : 0;
      const pageIndex = start + Math.round((query.locator.progression ?? 0) * (pages - 1));
      return {
        kind: 'location',
        location: { kind: 'page', pageIndex, drawn: false, matchedBy: 'progression' },
      };
    }
    const chapters =
      revision.chapterIndex === undefined
        ? this.chapters.map((_, spineIndex) => spineIndex)
        : [revision.chapterIndex];
    let start = 0;
    const ranges = chapters.map((spineIndex) => {
      const pages = this.pagesOf(spineIndex, revision.layout);
      const range = { spineIndex, startPage: start, endPage: start + pages - 1 };
      start += pages;
      return range;
    });
    return {
      kind: 'layout',
      layout: {
        pageCount: start,
        spreads: Array.from({ length: start }, (_, page) => ({ leftPageIndex: page })),
        chapters: ranges,
        tocTargets: ranges.map((range) => ({
          tocId: range.spineIndex,
          pageIndex: range.startPage,
        })),
        activeTocEntryByPage: ranges.flatMap((range) =>
          Array.from({ length: range.endPage - range.startPage + 1 }, () => range.spineIndex),
        ),
      },
    };
  }

  private publish(
    revision: Revision,
    page: number,
    origin: Owned['origin'],
    requested?: BrowserReaderLocator,
  ): BrowserReaderArtifact {
    if (this.live.size >= LIVE_ARTIFACT_CAP) {
      throw new RitoReaderError('artifact-capacity', 'live artifact cap reached');
    }
    const book = revision.chapterIndex === undefined;
    const artifact = {
      sessionId: this.sessionId,
      requestId: this.nextRequestId++,
      revisionId: revision.id,
      revisionVersion: 0,
      artifactId: this.nextArtifactId++,
      locator: requested ?? this.locatorOf(revision, page),
      matchedBy: 'progression',
      localPageIndex: page,
      localSpreadIndex: page,
      localPageIndexes: [page],
      width: revision.layout.viewportWidth,
      height: revision.layout.viewportHeight,
      ...(book ? { bookPageIndex: page, bookPageCount: this.spreadCount(revision) } : {}),
      textProfile: 'platform-string-runs',
      fonts: [],
      resources: [],
      pages: [],
    } as unknown as BrowserReaderArtifact;
    this.live.set(artifact.artifactId, { artifact, revision, origin });
    this.maxLive = Math.max(this.maxLive, this.live.size);
    return artifact;
  }

  private locatorOf(revision: Revision, page: number): BrowserReaderLocator {
    let chapterIndex = revision.chapterIndex ?? 0;
    let local = page;
    if (revision.chapterIndex === undefined) {
      while (local >= this.pagesOf(chapterIndex, revision.layout)) {
        local -= this.pagesOf(chapterIndex, revision.layout);
        chapterIndex += 1;
      }
    }
    const pages = this.pagesOf(chapterIndex, revision.layout);
    return {
      href: this.chapters[chapterIndex]?.href ?? '',
      progression: pages > 1 ? local / (pages - 1) : 0,
    };
  }

  private spreadCount(revision: Revision): number {
    if (revision.chapterIndex !== undefined) {
      return this.pagesOf(revision.chapterIndex, revision.layout);
    }
    return this.chapters.reduce((sum, _, index) => sum + this.pagesOf(index, revision.layout), 0);
  }

  chapterStart(chapterIndex: number, layout: BrowserReaderArtifactRequest['layout']): number {
    let start = 0;
    for (let index = 0; index < chapterIndex; index += 1) start += this.pagesOf(index, layout);
    return start;
  }
}

export interface FakeCanvasContext {
  readonly canvas: { width: number; height: number };
  readonly calls: string[];
}

/** A 2D context that records what was drawn on it. */
export function fakeCanvasContext(width: number, height: number): FakeCanvasContext {
  const calls: string[] = [];
  const record =
    (name: string) =>
    (...args: readonly unknown[]): void => {
      calls.push(`${name}(${args.join(',')})`);
    };
  return {
    canvas: { width, height },
    calls,
    save: record('save'),
    restore: record('restore'),
    resetTransform: record('resetTransform'),
    clearRect: record('clearRect'),
    fillRect: record('fillRect'),
    scale: record('scale'),
    fillStyle: '',
  } as unknown as FakeCanvasContext;
}
