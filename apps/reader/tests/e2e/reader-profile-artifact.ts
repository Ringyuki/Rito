import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ReaderProfileArtifactIdentity,
  ReaderProfileExecutionIdentity,
} from './reader-profile-model';

const READER_DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist');

export function readReaderProfileArtifactIdentity(): ReaderProfileArtifactIdentity {
  const root = lstatSync(READER_DIST);
  if (!root.isDirectory() || root.isSymbolicLink()) {
    throw new Error(`Reader profile dist must be a real directory: ${READER_DIST}`);
  }
  const files = walkFiles(READER_DIST);
  const hash = createHash('sha256');
  let byteLength = 0;
  for (const path of files) {
    const bytes = readFileSync(path);
    byteLength += bytes.byteLength;
    hash.update(relative(READER_DIST, path).replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(bytes);
    hash.update('\0');
  }
  return {
    schemaVersion: 1,
    id: 'rito/reader-dist-v1',
    readerDistSha256: hash.digest('hex'),
    fileCount: files.length,
    byteLength,
  };
}

export function readerProfileExecutionIdentity(
  env: Readonly<Record<string, string | undefined>>,
): ReaderProfileExecutionIdentity {
  const abPairId = env['RITO_READER_PROFILE_AB_PAIR_ID'] ?? null;
  const orderValue = env['RITO_READER_PROFILE_AB_ORDER'];
  const abOrder = orderValue === undefined ? null : Number(orderValue);
  const skippedE2eBuild = env['RITO_READER_SKIP_E2E_BUILD'] === '1';
  const strictServer = env['RITO_READER_STRICT_SERVER'] === '1';
  if (abPairId !== null) {
    if (abPairId.length === 0) throw new Error('Reader profile A/B pair id must not be empty');
    if (abOrder === null || !Number.isSafeInteger(abOrder) || abOrder < 0) {
      throw new Error('Reader profile A/B order must be a non-negative integer');
    }
    if (!skippedE2eBuild || !strictServer) {
      throw new Error('Reader profile A/B runs require strict server and skipped E2E rebuild');
    }
  } else if (abOrder !== null) {
    throw new Error('Reader profile A/B order requires a pair id');
  }
  return { skippedE2eBuild, strictServer, abPairId, abOrder };
}

function walkFiles(directory: string): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) paths.push(...walkFiles(path));
    else if (entry.isFile()) paths.push(path);
    else throw new Error(`Reader profile dist cannot contain symlinks/special files: ${path}`);
  }
  return paths.sort();
}
