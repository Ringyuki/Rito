import { EpubParseError } from './errors';
import { normalizeArchiveEntryPath, resolveArchiveHref } from './archive-path';
import type { ZipLimits } from './types';
import { unzip } from './unzip';

export interface ZipReader {
  readFile(path: string): Uint8Array;
  readTextFile(path: string): string;
  listFiles(): string[];
  close(): void;
}

export function createZipReader(data: ArrayBuffer, limits?: ZipLimits): ZipReader {
  let entries: Record<string, Uint8Array> | null = unzip(new Uint8Array(data), limits);
  const paths = Object.keys(entries);

  return {
    readFile(path: string): Uint8Array {
      if (!entries) throw new EpubParseError('ZipReader has been closed');
      // Try the literal ZIP spelling first, then URL-decode an EPUB href. Both
      // variants are dot-normalized and forbidden from escaping archive root.
      const literalPath = normalizeArchiveEntryPath(path);
      const literalEntry = entries[literalPath];
      const entry = literalEntry ?? entries[resolveArchiveHref('', path)];
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
