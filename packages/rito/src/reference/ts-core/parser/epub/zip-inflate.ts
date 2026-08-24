import { Inflate } from 'fflate';
import { EpubParseError } from './errors';

// Raw DEFLATE can expand one input byte roughly 1,032-fold. A 16 KiB input
// window bounds work and temporary output beyond the declared entry size to
// about 17 MiB before the streaming callback rejects forged metadata.
const MAX_INPUT_CHUNK = 16 * 1024;

export function inflateEntry(
  compressed: Uint8Array,
  expectedSize: number,
  filename: string,
): Uint8Array {
  const output = new Uint8Array(expectedSize);
  let outputOffset = 0;
  const inflater = new Inflate((chunk) => {
    if (outputOffset + chunk.length > output.length) {
      inconsistentSize(filename);
    }
    output.set(chunk, outputOffset);
    outputOffset += chunk.length;
  });

  if (compressed.length === 0) inflater.push(compressed, true);
  for (let inputOffset = 0; inputOffset < compressed.length; ) {
    const chunkLength = Math.min(compressed.length - inputOffset, MAX_INPUT_CHUNK);
    const nextOffset = inputOffset + chunkLength;
    inflater.push(compressed.subarray(inputOffset, nextOffset), nextOffset === compressed.length);
    inputOffset = nextOffset;
  }

  if (outputOffset !== expectedSize) inconsistentSize(filename);
  return output;
}

function inconsistentSize(filename: string): never {
  throw new EpubParseError(`ZIP entry has inconsistent uncompressed size: ${filename}`);
}
