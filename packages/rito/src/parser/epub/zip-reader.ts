import { unzipSync } from 'fflate';
import { EpubParseError } from './errors';

export interface ZipReader {
  readFile(path: string): Uint8Array;
  readTextFile(path: string): string;
  listFiles(): string[];
}

export function createZipReader(data: ArrayBuffer): ZipReader {
  const entries = unzipSync(new Uint8Array(data));
  const paths = Object.keys(entries);

  return {
    readFile(path: string): Uint8Array {
      const entry = entries[path];
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
  };
}
