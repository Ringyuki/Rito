import type { CoreReaderPrimitiveList } from './core-contracts';
import type { BrowserReaderArtifact, BrowserReaderSession } from './reader-session';
import { BrowserReaderCanvasUnsupportedError } from './reader-session-canvas-error';
import type { BrowserReaderCanvasDecodedImage } from './reader-session-canvas-image-cache-support';
import { BrowserReaderCanvasImageCache } from './reader-session-canvas-image-cache';
import type { BrowserReaderCanvasImageLease } from './reader-session-canvas-image-lease';
import {
  BrowserReaderCanvasResourceLimiter,
  settleCanvasResourcesWithLimiter,
} from './reader-session-canvas-resource-limiter';

type FontRef = BrowserReaderArtifact['fonts'][number];

interface FontEntry {
  /** The registered face; undefined for a face the browser refused to decode. */
  readonly promise: Promise<FontFace | undefined>;
  references: number;
}

export interface BrowserReaderCanvasFontOptions {
  /** A host face the page registers itself: waited for, never removed here. */
  readonly hostFont?: ((font: FontRef) => Promise<FontFace> | undefined) | undefined;
  /**
   * Told of a publication face the browser refused to decode. With it, the
   * artifact still prepares and paints the face's text with a fallback;
   * without it, preparing the artifact fails.
   */
  readonly fontRejected?: ((font: FontRef, error: unknown) => void) | undefined;
}

const RESOURCE_PREPARE_CONCURRENCY = 4;
const DISPOSED_DURING_PREPARE =
  'Browser reader session Canvas presenter was disposed during preparation.';

export interface BrowserReaderCanvasArtifactResources {
  hasImage(href: string): boolean;
  resolveImage(href: string): BrowserReaderCanvasDecodedImage | undefined;
  imageFallback(href: string): 'loading' | 'broken' | undefined;
  imageOpacity(href: string): number;
  onImagesChanged(listener: () => void): () => void;
  readonly imagesSettled: Promise<void>;
  release(): void;
}

export class BrowserReaderCanvasResourceOwner {
  private readonly fonts = new Map<string, FontEntry>();
  private readonly limiter = new BrowserReaderCanvasResourceLimiter(RESOURCE_PREPARE_CONCURRENCY);
  private readonly images: BrowserReaderCanvasImageCache;
  private disposed = false;

  private readonly hostFont: (font: FontRef) => Promise<FontFace> | undefined;
  private readonly fontRejected: BrowserReaderCanvasFontOptions['fontRejected'];

  constructor(
    private readonly session: BrowserReaderSession,
    options: BrowserReaderCanvasFontOptions = {},
  ) {
    this.hostFont = options.hostFont ?? (() => undefined);
    this.fontRejected = options.fontRejected;
    this.images = new BrowserReaderCanvasImageCache(session, this.limiter);
  }

  async prepare(
    artifact: BrowserReaderArtifact,
    list: CoreReaderPrimitiveList,
  ): Promise<BrowserReaderCanvasArtifactResources> {
    this.assertOpen();
    assertArtifactOwner(this.session, artifact);
    // A face the page registers itself is only waited for; the rest are
    // read from the session and counted, so the last artifact to use one
    // removes it.
    const hosted: Promise<FontFace>[] = [];
    const fonts = uniqueFonts(artifact).filter((font) => {
      const face = this.hostFont(font);
      if (face !== undefined) hosted.push(face);
      return face === undefined;
    });
    const fontKeys = fonts.map(fontKey);
    let imageLease: BrowserReaderCanvasImageLease | undefined;
    try {
      const [fontResult, imageResult] = await Promise.allSettled([
        Promise.all([this.acquireFonts(artifact, fonts), ...hosted]),
        this.images.prepare(artifact, list),
      ]);
      if (imageResult.status === 'fulfilled') imageLease = imageResult.value;
      const failure = [fontResult, imageResult].find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      if (!imageLease) throw new Error('reader session image preparation returned no lease.');
      this.assertOpen();
      return disposableResources(imageLease, () => {
        this.releaseFonts(fontKeys);
      });
    } catch (error: unknown) {
      releaseAfterFailure(
        imageLease,
        () => {
          this.releaseFonts(fontKeys);
        },
        error,
      );
      throw error;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const reason = new Error(DISPOSED_DURING_PREPARE);
    this.limiter.dispose(reason);
    const failures: unknown[] = [];
    try {
      this.images.dispose();
    } catch (error: unknown) {
      failures.push(error);
    }
    const fontSet = browserFontSet(false);
    for (const entry of this.fonts.values()) {
      if (!fontSet) continue;
      void entry.promise.then(
        (face) => face !== undefined && fontSet.delete(face),
        () => undefined,
      );
    }
    this.fonts.clear();
    if (failures.length) throw new AggregateError(failures, 'Canvas resource disposal failed.');
  }

  private async acquireFonts(
    artifact: BrowserReaderArtifact,
    fonts: readonly FontRef[],
  ): Promise<void> {
    const settled = await settleCanvasResourcesWithLimiter(fonts, this.limiter, (font) =>
      this.acquireFont(artifact, font),
    );
    const failure = settled.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }

  private acquireFont(
    artifact: BrowserReaderArtifact,
    font: FontRef,
  ): Promise<FontFace | undefined> {
    const key = fontKey(font);
    const cached = this.fonts.get(key);
    if (cached) {
      cached.references += 1;
      return cached.promise;
    }
    const entry: FontEntry = { references: 1, promise: this.createFont(artifact, font) };
    this.fonts.set(key, entry);
    void entry.promise.catch(() => {
      if (this.fonts.get(key) === entry) this.fonts.delete(key);
    });
    return entry.promise;
  }

  private async createFont(
    artifact: BrowserReaderArtifact,
    font: FontRef,
  ): Promise<FontFace | undefined> {
    const fontSet = browserFontSet(true);
    const resource = await this.session.readResource(artifact.artifactId, 'font', font.href);
    assertResource(resource, artifact, 'font', font.href);
    if (BigInt(resource.bytes.byteLength) !== font.byteLength) {
      throw new Error(`reader session font length mismatch for ${font.href}.`);
    }
    let face: FontFace;
    try {
      face = new FontFace(font.family, ownedArrayBuffer(resource.bytes), {
        style: font.style,
        weight: String(font.weight),
      });
      await face.load();
    } catch (error: unknown) {
      // The bytes are the engine's own; what failed is the browser's decoder.
      if (!this.fontRejected) throw error;
      this.fontRejected(font, error);
      return undefined;
    }
    this.assertOpen();
    fontSet.add(face);
    return face;
  }

  private releaseFonts(keys: readonly string[]): void {
    const fontSet = browserFontSet(false);
    for (const key of keys) {
      const entry = this.fonts.get(key);
      if (!entry) continue;
      entry.references -= 1;
      if (entry.references > 0) continue;
      this.fonts.delete(key);
      if (fontSet) {
        void entry.promise.then(
          (face) => face !== undefined && fontSet.delete(face),
          () => undefined,
        );
      }
    }
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error(DISPOSED_DURING_PREPARE);
  }
}

function uniqueFonts(
  artifact: BrowserReaderArtifact,
): readonly BrowserReaderArtifact['fonts'][number][] {
  const unique = new Map<string, BrowserReaderArtifact['fonts'][number]>();
  for (const font of artifact.fonts) unique.set(fontKey(font), font);
  return [...unique.values()];
}

function fontKey(font: BrowserReaderArtifact['fonts'][number]): string {
  return `${font.family}\u0000${font.style}\u0000${String(font.weight)}\u0000${font.shapeFingerprint}`;
}

function assertArtifactOwner(session: BrowserReaderSession, artifact: BrowserReaderArtifact): void {
  if (artifact.sessionId !== session.sessionId) {
    throw new Error('reader session artifact belongs to another session.');
  }
}

function assertResource(
  resource: Awaited<ReturnType<BrowserReaderSession['readResource']>>,
  artifact: BrowserReaderArtifact,
  kind: 'font' | 'image',
  href: string,
): void {
  if (
    resource.artifactId !== artifact.artifactId ||
    resource.kind !== kind ||
    resource.href !== href
  ) {
    throw new Error(`reader session returned a mismatched ${kind} resource for ${href}.`);
  }
}

function browserFontSet(required: true): FontFaceSet;
function browserFontSet(required: false): FontFaceSet | undefined;
function browserFontSet(required: boolean): FontFaceSet | undefined {
  const realm = globalThis as typeof globalThis & { readonly fonts?: FontFaceSet | undefined };
  const fontSet = realm.fonts ?? (typeof document === 'undefined' ? undefined : document.fonts);
  if (!fontSet && required) throw new BrowserReaderCanvasUnsupportedError('FontFaceSet');
  if (typeof FontFace === 'undefined' && required) {
    throw new BrowserReaderCanvasUnsupportedError('FontFace');
  }
  return fontSet;
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function disposableResources(
  images: BrowserReaderCanvasImageLease,
  releaseFonts: () => void,
): BrowserReaderCanvasArtifactResources {
  let released = false;
  return {
    hasImage: (href) => !released && images.has(href),
    resolveImage: (href) => (released ? undefined : images.resolve(href)),
    imageFallback: (href) => (released ? undefined : images.fallback(href)),
    imageOpacity: (href) => images.opacity(href),
    onImagesChanged: (listener) => images.subscribe(listener),
    imagesSettled: images.settled,
    release() {
      if (released) return;
      released = true;
      releaseAfterFailure(images, releaseFonts);
    },
  };
}

function releaseAfterFailure(
  images: BrowserReaderCanvasImageLease | undefined,
  releaseFonts: () => void,
  primaryError?: unknown,
): void {
  const failures: unknown[] = [];
  try {
    images?.release();
  } catch (error: unknown) {
    failures.push(error);
  }
  try {
    releaseFonts();
  } catch (error: unknown) {
    failures.push(error);
  }
  if (failures.length) {
    throw new AggregateError(
      primaryError === undefined ? failures : [primaryError, ...failures],
      'reader session Canvas resource release failed.',
    );
  }
}
