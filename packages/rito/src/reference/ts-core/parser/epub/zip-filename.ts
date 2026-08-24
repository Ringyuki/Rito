import { EpubParseError } from './errors';

// Code points 0x80..0xff from IBM code page 437, ZIP's legacy filename encoding.
const CP437_HIGH = Array.from(
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ',
);

const UTF8_FILENAME_FLAG = 1 << 11;
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

/** Decode a central-directory filename according to ZIP's general-purpose flag. */
export function decodeZipFilename(bytes: Uint8Array, flags: number): string {
  if ((flags & UTF8_FILENAME_FLAG) !== 0) {
    try {
      return UTF8_DECODER.decode(bytes);
    } catch {
      throw new EpubParseError('ZIP entry has an invalid UTF-8 filename');
    }
  }

  let result = '';
  for (const byte of bytes) {
    result += byte < 0x80 ? String.fromCharCode(byte) : (CP437_HIGH[byte - 0x80] ?? '');
  }
  return result;
}
