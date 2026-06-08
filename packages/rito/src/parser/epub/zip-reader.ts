import { EpubParseError } from './errors';
import { unzip } from './unzip';

export interface ZipReader {
  readFile(path: string): Uint8Array;
  readTextFile(path: string): string;
  listFiles(): string[];
  close(): void;
}

export function createZipReader(data: ArrayBuffer): ZipReader {
  let entries: Record<string, Uint8Array> | null = unzip(new Uint8Array(data));
  const paths = Object.keys(entries);

  return {
    readFile(path: string): Uint8Array {
      if (!entries) throw new EpubParseError('ZipReader has been closed');
      // OPF/NCX hrefs are URLs, so they may be percent-encoded (e.g.
      // "Character%20Profile.xhtml") while the actual zip entry name is literal.
      // Try the raw path first, then fall back to its percent-decoded form.
      const entry = entries[path] ?? entries[percentDecodePath(path)];
      if (!entry) {
        throw new EpubParseError(`File not found in EPUB archive: ${path}`);
      }
      return entry;
    },

    readTextFile(path: string): string {
      const bytes = this.readFile(path);
      return new TextDecoder().decode(bytes);
    },

    listFiles(): string[] {
      return paths;
    },

    close(): void {
      entries = null;
    },
  };
}

/** Percent-decode a container path, falling back to the raw path if malformed. */
function percentDecodePath(path: string): string {
  if (!path.includes('%')) return path;
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
