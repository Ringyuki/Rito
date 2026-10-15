import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BOOK, CLI, book } from './helpers';

const run = promisify(execFile);
const cli = fileURLToPath(CLI);

interface ManifestEntry {
  readonly id: number;
  readonly file: string;
  readonly byteLength: number;
  readonly files: readonly string[];
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rito-pack-cli-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('rito-pack', () => {
  it('writes the shards, a manifest without keys, and the keys apart', async () => {
    await writeFile(join(dir, 'book.epub'), BOOK);
    const out = join(dir, 'out');
    const { stdout } = await run(process.execPath, [cli, join(dir, 'book.epub'), out, '--encrypt']);
    expect(stdout).toMatch(/12 content shards, skeleton \d+ bytes, encrypted/);

    const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8')) as {
      readonly format: string;
      readonly formatVersion: number;
      readonly bookId: string;
      readonly encrypted: boolean;
      readonly skeleton: ManifestEntry;
      readonly shards: readonly ManifestEntry[];
    };
    const keys = JSON.parse(await readFile(join(out, 'keys.json'), 'utf8')) as {
      readonly bookId: string;
      readonly keys: Readonly<Record<string, string>>;
    };
    expect(manifest).toMatchObject({ format: 'rito-publication-shards', formatVersion: 3 });
    expect(manifest.encrypted).toBe(true);
    expect(JSON.stringify(manifest)).not.toContain(Object.values(keys.keys)[0]);
    expect(keys.bookId).toBe(manifest.bookId);

    const entries = [manifest.skeleton, ...manifest.shards];
    expect(manifest.skeleton.file).toBe('skeleton.rshd');
    expect(Object.keys(keys.keys).sort()).toEqual(entries.map((entry) => String(entry.id)).sort());
    for (const entry of entries) {
      expect((await stat(join(out, entry.file))).size).toBe(entry.byteLength);
      expect(keys.keys[String(entry.id)]).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('checks a book, and exits 1 for one the reader cannot read', async () => {
    await writeFile(join(dir, 'good.epub'), book());
    const { stdout } = await run(process.execPath, [cli, '--check', join(dir, 'good.epub')]);
    expect(stdout).toContain('readable, 0 problems');

    await writeFile(join(dir, 'bad.epub'), book({ 'chapter-2.xhtml': undefined }));
    const failure = await run(process.execPath, [cli, '--check', join(dir, 'bad.epub')]).then(
      () => undefined,
      (error: unknown) => error as { code: number; stderr: string },
    );
    expect(failure?.code).toBe(1);
    expect(failure?.stderr).toContain('unreadable');
  });

  it('runs in a host started with flags a worker cannot take', async () => {
    const index = new URL('../dist/index.mjs', import.meta.url).href;
    const script = [
      `const { checkPublication } = await import(${JSON.stringify(index)});`,
      "const check = await checkPublication(new TextEncoder().encode('plain text'));",
      'console.log(check.readable);',
    ].join('\n');
    const { stdout } = await run(process.execPath, ['--input-type=module', '--eval', script]);
    expect(stdout.trim()).toBe('false');
  });

  it('prints its usage and exits 1 when the arguments are wrong', async () => {
    const failure = await run(process.execPath, [cli, '--check']).then(
      () => undefined,
      (error: unknown) => error as { code: number; stderr: string },
    );
    expect(failure?.code).toBe(1);
    expect(failure?.stderr).toContain('usage: rito-pack');
  });
});
