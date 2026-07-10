import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

/**
 * Persist canonical fixture text without treating compressor-version changes as
 * fixture changes. Existing gzip bytes are retained whenever their payload is
 * already current.
 */
export async function writeCanonicalFixture(input) {
  const path = resolve(input.outputRoot, input.relativePath);
  const canonicalBytes = Buffer.from(input.text);
  const existing = await readOptionalFile(path);
  const current = existing
    ? hasCanonicalPayload(existing, canonicalBytes, input.relativePath.endsWith('.gz'))
    : false;

  if (input.check) {
    if (!current) throw new Error(`Rust parity fixture is stale: ${input.relativePath}`);
    return 'unchanged';
  }
  if (current) return 'unchanged';

  const output = input.relativePath.endsWith('.gz')
    ? gzipSync(canonicalBytes, { level: 9 })
    : canonicalBytes;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, output);
  return 'written';
}

function hasCanonicalPayload(existing, canonical, compressed) {
  if (!compressed) return existing.equals(canonical);
  try {
    return gunzipSync(existing).equals(canonical);
  } catch {
    return false;
  }
}

async function readOptionalFile(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function isNodeError(error) {
  return typeof error === 'object' && error !== null && 'code' in error;
}
