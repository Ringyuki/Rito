import { runTask } from './run';
import type { PackOptions, PackedPublication, PublicationCheck } from './types';

export type {
  PackOptions,
  PackedPublication,
  PackedShard,
  PublicationCheck,
  PublicationProblem,
} from './types';

/**
 * Splits an EPUB into a skeleton and one content shard per image, audio or
 * video file. Each call runs on a worker thread of its own. Rejects with the
 * engine's reason when the EPUB cannot be opened.
 */
export async function packPublication(
  epub: Uint8Array | ArrayBuffer,
  options: PackOptions = {},
): Promise<PackedPublication> {
  const result = await runTask({
    kind: 'pack',
    epub: bytesOf(epub),
    encrypt: options.encrypt === true,
  });
  if (result.kind !== 'pack') throw new Error('The pack worker answered another task');
  return result.value;
}

/**
 * Whether the Rito reader can read an EPUB, decided without laying it out:
 * the reader's own open, every chapter, every image size and font laying the
 * book out reads, and each chapter's stylesheet links and `style`
 * attributes. Each call runs on a worker thread of its own.
 */
export async function checkPublication(epub: Uint8Array | ArrayBuffer): Promise<PublicationCheck> {
  const result = await runTask({ kind: 'check', epub: bytesOf(epub) });
  if (result.kind !== 'check') throw new Error('The pack worker answered another task');
  return result.value;
}

function bytesOf(epub: Uint8Array | ArrayBuffer): Uint8Array {
  if (epub instanceof Uint8Array) return epub;
  if (epub instanceof ArrayBuffer) return new Uint8Array(epub);
  throw new TypeError('The EPUB must be a Uint8Array or an ArrayBuffer');
}
