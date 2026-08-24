import { EpubParseError } from './errors';

export function diagnoseInvalidZip(bytes: Uint8Array): never {
  if (bytes.length < 4) throw new EpubParseError('Data too small to be a valid EPUB file');
  if (bytes[0] === 0x3c) {
    const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 256)));
    throw new EpubParseError(
      `Expected an EPUB (ZIP) file but received an HTML/XML document. ` +
        `The server may have returned an error page. Starts with: ${JSON.stringify(head.slice(0, 120))}`,
    );
  }
  const hex = Array.from(bytes.subarray(0, 4))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join(' ');
  throw new EpubParseError(
    `Not a valid EPUB (ZIP) file. No ZIP signature found. First bytes: [${hex}]`,
  );
}
