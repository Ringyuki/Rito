import type { ReaderHostFontFace } from '../../../reader';
import type { BrowserReaderArtifact } from '../reader-session';

type FontRef = BrowserReaderArtifact['fonts'][number];

/** The href the engine gives a host face: this prefix, then its SHA-256. */
const HOST_FONT_HREF_PREFIX = 'rito-host-font:';
/** The family the engine paints a host face under: this prefix, then its SHA-256. */
const HOST_FONT_FAMILY_PREFIX = '__RitoPinned_';
/**
 * A family alias names exactly one face, so a registration that accepts
 * every weight is that face at whichever weight the engine asks for,
 * without the browser synthesizing one.
 */
const EVERY_WEIGHT = '1 1000';

interface HeldFace {
  readonly bytes: Blob;
  /** The upright registration, accepting every weight. */
  upright: Promise<FontFace> | undefined;
  /** Registrations under another style, by `style|weight`. */
  readonly styled: Map<string, Promise<FontFace>>;
}

/**
 * The host faces a reader paints with, registered with the page from the
 * reader's own copy of their bytes and kept for as long as the reader is
 * open, so a family coming back into use costs nothing.
 *
 * A face is loaded from a blob URL: the browser decodes that off the page's
 * thread, where building a face straight from its bytes holds the page for
 * the whole decode (70ms for an 11MB face).
 */
export class SessionReaderHostFonts {
  private readonly held = new Map<string, HeldFace>();
  private readonly registered = new Set<FontFace>();
  private disposed = false;

  /** Holds a copy of each face and registers it. */
  add(faces: readonly Pick<ReaderHostFontFace, 'bytes' | 'expectedSha256'>[]): void {
    for (const face of faces) {
      const sha256 = face.expectedSha256.toLowerCase();
      if (this.held.has(sha256)) continue;
      const held: HeldFace = {
        bytes: new Blob([face.bytes]),
        upright: undefined,
        styled: new Map(),
      };
      this.held.set(sha256, held);
      this.upright(sha256, held).catch(ignore);
    }
  }

  remove(sha256s: readonly string[]): void {
    for (const sha256 of sha256s) {
      const held = this.held.get(sha256.toLowerCase());
      if (!held) continue;
      this.held.delete(sha256.toLowerCase());
      for (const face of [held.upright, ...held.styled.values()]) {
        void face?.then((loaded) => {
          this.unregister(loaded);
        }, ignore);
      }
    }
  }

  /**
   * The registered face a font reference names. Undefined for a font that
   * is not one of the reader's host faces.
   */
  resolve(font: FontRef): Promise<FontFace> | undefined {
    if (this.disposed || !font.href.startsWith(HOST_FONT_HREF_PREFIX)) return undefined;
    const sha256 = font.href.slice(HOST_FONT_HREF_PREFIX.length);
    const held = this.held.get(sha256);
    if (held === undefined || font.family !== HOST_FONT_FAMILY_PREFIX + sha256) return undefined;
    if (BigInt(held.bytes.size) !== font.byteLength) return undefined;
    if (font.style === 'normal') return this.upright(sha256, held);
    const key = `${font.style}|${String(font.weight)}`;
    let face = held.styled.get(key);
    if (face === undefined) {
      face = this.register(sha256, held.bytes, font.style, String(font.weight));
      held.styled.set(key, face);
    }
    return face;
  }

  dispose(): void {
    this.disposed = true;
    this.held.clear();
    for (const face of [...this.registered]) this.unregister(face);
  }

  private upright(sha256: string, held: HeldFace): Promise<FontFace> {
    held.upright ??= this.register(sha256, held.bytes, 'normal', EVERY_WEIGHT);
    return held.upright;
  }

  private async register(
    sha256: string,
    bytes: Blob,
    style: string,
    weight: string,
  ): Promise<FontFace> {
    const face = await loadFace(HOST_FONT_FAMILY_PREFIX + sha256, bytes, { style, weight });
    if (this.disposed) throw new Error('Reader closed while a host font face loaded');
    fontSet().add(face);
    this.registered.add(face);
    return face;
  }

  private unregister(face: FontFace): void {
    if (this.registered.delete(face)) fontSet().delete(face);
  }
}

async function loadFace(
  family: string,
  bytes: Blob,
  descriptors: FontFaceDescriptors,
): Promise<FontFace> {
  const url = URL.createObjectURL(bytes);
  try {
    const face = new FontFace(family, `url("${url}")`, descriptors);
    await face.load();
    return face;
  } catch {
    // A page whose policy refuses fonts from blob URLs still takes the bytes.
    const face = new FontFace(family, await bytes.arrayBuffer(), descriptors);
    await face.load();
    return face;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function fontSet(): FontFaceSet {
  const realm = globalThis as typeof globalThis & { readonly fonts?: FontFaceSet };
  return realm.fonts ?? document.fonts;
}

function ignore(): void {}
