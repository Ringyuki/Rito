import { RitoReaderError } from '@ritojs/core-wasm/decoder';

import type {
  BrowserReaderAnnotationQuery,
  BrowserReaderAnnotationResponse,
  BrowserReaderArtifact,
  BrowserReaderArtifactRequest,
  BrowserReaderExactSourceRangeResolution,
  BrowserReaderFootnote,
  BrowserReaderGeometryOptions,
  BrowserReaderLocator,
  BrowserReaderNavigationQuery,
  BrowserReaderNavigationResult,
  BrowserReaderPublication,
  BrowserReaderSearchResponse,
  BrowserReaderSession,
  BrowserReaderSourceRange,
  BrowserReaderTextInteractionQuery,
  BrowserReaderTextInteractionResponse,
} from '../../src/bindings/browser/reader-session';

type FakePage = BrowserReaderArtifact['pages'][number];

/** A geometry question as the session received it. */
export interface FakeGeometryQuestion<Question> {
  readonly artifactId: bigint;
  readonly question: Question;
  readonly options: BrowserReaderGeometryOptions | undefined;
}

/** The session's live-artifact cap, as the engine and the worker that hosts it enforce it. */
export const LIVE_ARTIFACT_CAP = 6;

/** The session requests a test can have refused. */
export type FakeRefusable =
  | 'requestArtifact'
  | 'peekSpread'
  | 'adoptForegroundCandidate'
  | 'adoptBackgroundCandidate'
  | 'navigation'
  | 'release';

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
 * artifact is a compare-and-swap, at most six artifacts are live, and the
 * book is not laid out while a requested artifact waits to be adopted.
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
  /** The artifact the newest request published, until it is adopted or released. */
  private foregroundCandidate: bigint | undefined;
  private readonly refusals = new Map<FakeRefusable, Error[]>();
  /** Runs as the session refuses a call, before the caller learns of it. */
  onRefusal: ((method: FakeRefusable) => void) | undefined;
  initialArtifact!: BrowserReaderArtifact;
  /** What a page publishes beside its index; `chapterIndex` is undefined in the whole book. */
  pageContent: (pageIndex: number, chapterIndex: number | undefined) => Partial<FakePage> =
    () => ({});
  readonly interactions: FakeGeometryQuestion<BrowserReaderTextInteractionQuery>[] = [];
  readonly sourceRanges: FakeGeometryQuestion<{
    readonly href: string;
    readonly range: BrowserReaderSourceRange;
  }>[] = [];
  readonly annotations: BrowserReaderAnnotationQuery[] = [];
  answerInteraction: (
    query: BrowserReaderTextInteractionQuery,
  ) => BrowserReaderTextInteractionResponse['result'] = () => ({ kind: 'miss' });
  answerSourceRange: () => Omit<BrowserReaderExactSourceRangeResolution, 'artifactId'> = () => ({
    status: 'unavailable',
    selectedText: '',
    rects: [],
  });
  answerAnnotation: (query: BrowserReaderAnnotationQuery) => BrowserReaderAnnotationResponse =
    () => ({ level: 'orphaned-href-not-found' });
  /** Answers the navigation questions that do not depend on a layout. */
  answerPosition: (query: BrowserReaderNavigationQuery) => BrowserReaderNavigationResult = () => {
    throw new Error('no position answer was set');
  };
  readonly footnotes = new Map<string, Pick<BrowserReaderFootnote, 'kind' | 'text' | 'html'>>();
  /** The resources every artifact published from now on lists. */
  resources: BrowserReaderArtifact['resources'] = [];
  /** The faces every artifact lists: the host's, each under its own descriptors. */
  fonts: BrowserReaderArtifact['fonts'] = [];
  /** Searches as the session received them: whether the artifact was a whole-book one. */
  readonly searches: { readonly book: boolean; readonly query: string }[] = [];
  searchResults: BrowserReaderSearchResponse['results'] = [];
  readonly fontCalls: string[] = [];

  constructor(
    readonly chapters: readonly FakeChapter[],
    request: BrowserReaderArtifactRequest,
  ) {
    this.initialArtifact = this.request(request);
  }

  /**
   * Has the session refuse its next `times` calls of `method` with `error`,
   * changing nothing, as it does when it is occupied or out of room.
   */
  refuse(method: FakeRefusable, error: Error, times = 1): void {
    const queued = this.refusals.get(method) ?? [];
    for (let count = 0; count < times; count += 1) queued.push(error);
    this.refusals.set(method, queued);
  }

  session(): BrowserReaderSession {
    const later = <Value>(run: () => Value, method?: FakeRefusable): Promise<Value> =>
      new Promise((resolve, reject) => {
        setTimeout(() => {
          try {
            if (this.disposed) throw new RitoReaderError('session-disposed', 'disposed');
            const refusal = method && this.refusals.get(method)?.shift();
            if (refusal) {
              this.calls.push(`refused ${method}`);
              this.onRefusal?.(method);
              throw refusal;
            }
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
      requestArtifact: (request) => later(() => this.request(request), 'requestArtifact'),
      peekSpread: (from, spreadIndex) =>
        later(() => this.peekSpread(from, spreadIndex), 'peekSpread'),
      commitPeekedArtifact: (expected, candidate) =>
        later(() => this.commit(expected, candidate, true)),
      adoptForegroundCandidate: (expected, candidate) =>
        later(() => this.commit(expected, candidate, false), 'adoptForegroundCandidate'),
      advanceBackgroundOnce: async (expected) => {
        this.calls.push('advance');
        if (this.backgroundGate) await this.backgroundGate;
        return later(() => this.advance(expected));
      },
      adoptBackgroundCandidate: (expected, candidate) =>
        later(() => {
          if (this.foregroundCandidate !== undefined) {
            throw new RitoReaderError('stale-request', 'background yields to foreground');
          }
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
        }, 'adoptBackgroundCandidate'),
      navigation: (query) => later(() => this.navigation(query), 'navigation'),
      textInteraction: (artifactId, question, options) =>
        later(() => {
          this.requireLive(artifactId);
          this.interactions.push({ artifactId, question, options });
          return { artifactId, result: this.answerInteraction(question) };
        }),
      exactSourceRange: (artifactId, href, range, options) =>
        later(() => {
          this.requireLive(artifactId);
          this.sourceRanges.push({ artifactId, question: { href, range }, options });
          return { artifactId, ...this.answerSourceRange() };
        }),
      annotation: (query) =>
        later(() => {
          this.annotations.push(query);
          return this.answerAnnotation(query);
        }),
      readFootnote: (artifactId, key) =>
        later(() => {
          this.requireLive(artifactId);
          const note = this.footnotes.get(key);
          if (!note) {
            throw new RitoReaderError('target-not-published', 'footnote is not indexed yet');
          }
          return { artifactId, key, ...note };
        }),
      search: (artifactId, options) =>
        later(() => {
          const owned = this.requireLive(artifactId);
          this.searches.push({
            book: owned.revision.chapterIndex === undefined,
            query: options.query,
          });
          return {
            artifactId,
            query: options.query,
            truncated: false,
            searchedPageCount: this.spreadCount(owned.revision),
            results: this.searchResults,
          };
        }),
      readResource: (artifactId, kind, href) =>
        later(() => {
          const owned = this.requireLive(artifactId);
          if (!owned.artifact.resources.some((item) => item.kind === kind && item.href === href)) {
            throw new RitoReaderError('invalid-request', 'artifact does not reference the href');
          }
          return {
            artifactId,
            kind,
            href,
            mediaType: 'image/png',
            bytes: new Uint8Array([1, 2, 3]),
          };
        }),
      addFontFaces: (faces) =>
        later(() => {
          this.fontCalls.push(`add ${faces.map((face) => face.expectedSha256).join(',')}`);
        }),
      removeFontFaces: (sha256s) =>
        later(() => {
          this.fontCalls.push(`remove ${sha256s.join(',')}`);
        }),
      markFontFamiliesUnavailable: (families) =>
        later(() => {
          this.fontCalls.push(`unavailable ${families.join(',')}`);
        }),
      release: (artifactId) =>
        later(() => {
          if (artifactId === this.visibleId) throw new Error('released the visible artifact');
          this.peeked.delete(artifactId);
          this.candidates.delete(artifactId);
          if (this.foregroundCandidate === artifactId) this.foregroundCandidate = undefined;
          return this.live.delete(artifactId);
        }, 'release'),
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
    // A request replaces whatever an earlier one left waiting to be adopted.
    this.foregroundCandidate = undefined;
    const artifact = this.publish(revision, page, 'request', request.locator);
    this.foregroundCandidate = artifact.artifactId;
    return artifact;
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
    // Only the newest request's artifact is adopted; a peek does not disturb it.
    if (!peek && this.foregroundCandidate !== candidate) {
      throw new RitoReaderError('stale-request', 'no such foreground candidate is pending');
    }
    this.foregroundCandidate = undefined;
    this.visibleId = candidate;
    this.calls.push(`${peek ? 'commit' : 'adopt'} ${String(candidate)}`);
    return { intentRequestId: 0n, replacedArtifactId: expected, visibleArtifactId: candidate };
  }

  private advance(expected: bigint) {
    if (this.foregroundCandidate !== undefined) {
      throw new RitoReaderError('stale-request', 'background yields to foreground');
    }
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

  private requireLive(artifactId: bigint): Owned {
    const owned = this.live.get(artifactId);
    if (!owned) throw new RitoReaderError('unknown-artifact', 'artifact is not live');
    return owned;
  }

  private navigation(query: BrowserReaderNavigationQuery): BrowserReaderNavigationResult {
    if (query.kind !== 'layout' && query.kind !== 'locate') return this.answerPosition(query);
    const { revision } = this.requireLive(query.artifactId);
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
      fonts: this.fonts,
      resources: this.resources,
      pages: [
        {
          pageIndex: page,
          width: revision.layout.viewportWidth,
          height: revision.layout.viewportHeight,
          hits: [],
          semantics: [],
          text: '',
          textLength: 0n,
          textRuns: [],
          ...this.pageContent(page, revision.chapterIndex),
        },
      ],
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
