import type { ReaderHostFontFace } from '../../../reader';
import type { BrowserReaderArtifact } from '../reader-session';

type FontRef = BrowserReaderArtifact['fonts'][number];

/** The href the engine gives a host face: this prefix, then its SHA-256. */
const HOST_FONT_HREF_PREFIX = 'rito-host-font:';
/** The family the engine paints a host face under: this prefix, then its SHA-256. */
const HOST_FONT_FAMILY_PREFIX = '__RitoPinned_';

interface HeldFace {
  readonly bytes: Blob;
  /** The face decoded from the bytes, not yet known to the page. */
  readonly loaded: Promise<FontFace>;
  /** The face given the descriptors the engine lists it with, and registered. */
  registered: Promise<FontFace> | undefined;
}

/**
 * The host faces a reader paints with, registered with the page from the
 * reader's own copy of their bytes and kept for as long as the reader is
 * open, so a family coming back into use costs nothing.
 *
 * A face is registered under its own style and weight, the ones the engine
 * lists it with. A run asks for the weight and style of its text, and where
 * the face has another the browser synthesizes the difference, as it does
 * for the same text in a page: a face registered as every weight would
 * paint a bold heading with regular strokes.
 *
 * A face is loaded from a blob URL: the browser decodes that off the page's
 * thread, where building a face straight from its bytes holds the page for
 * the whole decode (70ms for an 11MB face). Decoding starts when the face
 * is added, before the first page that names it.
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
      const bytes = new Blob([face.bytes]);
      const loaded = loadFace(HOST_FONT_FAMILY_PREFIX + sha256, bytes);
      loaded.catch(ignore);
      this.held.set(sha256, { bytes, loaded, registered: undefined });
    }
  }

  remove(sha256s: readonly string[]): void {
    for (const sha256 of sha256s) {
      const held = this.held.get(sha256.toLowerCase());
      if (!held) continue;
      this.held.delete(sha256.toLowerCase());
      void held.registered?.then((face) => {
        this.unregister(face);
      }, ignore);
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
    held.registered ??= this.register(held, font);
    return held.registered;
  }

  dispose(): void {
    this.disposed = true;
    this.held.clear();
    for (const face of [...this.registered]) this.unregister(face);
  }

  private async register(held: HeldFace, font: FontRef): Promise<FontFace> {
    const face = await held.loaded;
    if (this.disposed) throw new Error('Reader closed while a host font face loaded');
    face.style = font.style;
    face.weight = String(font.weight);
    fontSet().add(face);
    this.registered.add(face);
    return face;
  }

  private unregister(face: FontFace): void {
    if (this.registered.delete(face)) fontSet().delete(face);
  }
}

async function loadFace(family: string, bytes: Blob): Promise<FontFace> {
  const url = URL.createObjectURL(bytes);
  try {
    const face = new FontFace(family, `url("${url}")`);
    await face.load();
    return face;
  } catch {
    // A page whose policy refuses fonts from blob URLs still takes the bytes.
    const face = new FontFace(family, await bytes.arrayBuffer());
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
